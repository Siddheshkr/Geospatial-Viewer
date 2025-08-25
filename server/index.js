// server/index.js
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const { z } = require("zod");
const { verifyToken } = require("@clerk/clerk-sdk-node");

// Import routes and middleware
const aoiRoutes = require("./routes/aoiRoutes");
const Aoi = require("./models/Aoi");
const { requireAuth } = require("./middleware/auth");

// Import fetch for Node.js < 18
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  fetch = require('node-fetch');
} else {
  fetch = globalThis.fetch;
}

dotenv.config();

const app = express(); // <-- create app 

// ---- Middleware ----
app.use(express.json()); // parse JSON bodies

// --- CORS (allow frontend) ---
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"], // Next.js dev server
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Handle preflight OPTIONS requests
app.options("*", cors());

// Add headers middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

// ---- MongoDB connection ----
if (!process.env.MONGO_URI) {
  console.error("Missing MONGO_URI in environment");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected");
    try {
      // Seed two permanent sample AOIs if not present
      const publicCount = await Aoi.countDocuments({ userId: "public" });
      if (publicCount === 0) {
        await Aoi.create([
          {
            userId: "public",
            name: "Sample AOI - Downtown",
            description: "Demo polygon near city center",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [91.2805, 23.8352],
                  [91.288, 23.8352],
                  [91.288, 23.8408],
                  [91.2805, 23.8408],
                  [91.2805, 23.8352],
                ],
              ],
            },
          },
          {
            userId: "public",
            name: "Sample AOI - Park Marker",
            description: "Demo point for a park",
            geometry: { type: "Point", coordinates: [91.295, 23.84] },
          },
        ]);
        console.log("Seeded public sample AOIs");
      }
    } catch (e) {
      console.warn("Sample AOI seeding skipped:", e?.message || e);
    }
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message || err);
    console.log("Server will start without database connection. Some features may not work.");
    // Don't exit, let the server start for testing
  });

// ---- Zod schemas ----
const geoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.array(z.number()))).refine(
    (coords) => {
      if (coords.length === 0) return false;
      const ring = coords[0];
      if (ring.length < 4) return false;
      // Check if first and last points are the same (closed polygon)
      const first = ring[0];
      const last = ring[ring.length - 1];
      return first[0] === last[0] && first[1] === last[1];
    },
    "Invalid polygon: must have at least 4 points and be closed"
  ),
});

const aoiInputSchema = z.object({
  geometry: geoJsonPolygonSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  properties: z.record(z.string()).optional(),
});

const bboxSchema = z.object({
  minLng: z.coerce.number().finite(),
  minLat: z.coerce.number().finite(),
  maxLng: z.coerce.number().finite(),
  maxLat: z.coerce.number().finite(),
});

const featureInfoSchema = z.object({
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
  bbox: z.string(),
  width: z.coerce.number().int().min(1),
  height: z.coerce.number().int().min(1),
  layers: z.string(),
});

// ---- Routes ----
app.get("/health", (req, res) => res.json({ 
  ok: true, 
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  environment: process.env.NODE_ENV || "development"
}));

// Debug endpoint to test authentication
app.get("/debug/auth", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const bearerPrefix = "Bearer ";
  
  if (!authHeader.startsWith(bearerPrefix)) {
    return res.json({
      error: "No valid Authorization header",
      received: authHeader ? "Yes" : "No",
      header: authHeader
    });
  }
  
  const token = authHeader.slice(bearerPrefix.length).trim();
  return res.json({
    tokenReceived: token ? "Yes" : "No",
    tokenLength: token ? token.length : 0,
    tokenPreview: token ? `${token.substring(0, 20)}...` : "None",
    clerkKey: process.env.CLERK_SECRET_KEY ? "Configured" : "Missing"
  });
});

// Use AOI routes
app.use("/aoi", aoiRoutes);

// Simple in-memory cache for WMS requests
const wmsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000; // Maximum number of cached items

// Cache cleanup function
function cleanupCache() {
  const now = Date.now();
  const entries = Array.from(wmsCache.entries());
  
  // Remove expired entries
  for (const [key, value] of entries) {
    if (now - value.timestamp > CACHE_TTL) {
      wmsCache.delete(key);
    }
  }
  
  // If still too many entries, remove oldest ones
  if (wmsCache.size > MAX_CACHE_SIZE) {
    const sortedEntries = entries
      .filter(([_, value]) => now - value.timestamp <= CACHE_TTL)
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = sortedEntries.slice(0, wmsCache.size - MAX_CACHE_SIZE);
    toRemove.forEach(([key]) => wmsCache.delete(key));
  }
}

// Clean cache every 5 minutes
setInterval(cleanupCache, 5 * 60 * 1000);

// GET /wms/feature-info → WMS GetFeatureInfo proxy with caching
app.get("/wms/feature-info", async (req, res, next) => {
  try {
    const { x, y, bbox, width, height, layers } = featureInfoSchema.parse(req.query);
    
    // Create cache key
    const cacheKey = `${layers}-${x}-${y}-${bbox}-${width}-${height}`;
    
    // Check cache
    const cached = wmsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }
    
    const wmsUrl = "https://geoserver01.haketech.com/geoserver/wms";
    const params = new URLSearchParams({
      service: "WMS",
      version: "1.1.1",
      request: "GetFeatureInfo",
      layers: layers,
      query_layers: layers,
      info_format: "application/json",
      feature_count: "10",
      x: x.toString(),
      y: y.toString(),
      bbox: bbox,
      width: width.toString(),
      height: height.toString(),
      srs: "EPSG:4326",
    });

    const response = await fetch(`${wmsUrl}?${params.toString()}`);
    
    if (!response.ok) {
      throw new Error(`WMS request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Cache the response
    wmsCache.set(cacheKey, {
      data: data,
      timestamp: Date.now()
    });
    
    res.json(data);
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ 
        error: "Invalid query parameters", 
        details: err.errors 
      });
    }
    
    console.error("WMS feature info error:", err);
    res.status(500).json({ 
      error: "Failed to fetch feature information",
      message: err.message 
    });
  }
});

// ---- Centralized error handler ----
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err?.message || err);
  if (err?.name === "ZodError") {
    return res
      .status(400)
      .json({ error: "Invalid input", details: err.errors });
  }
  return res.status(500).json({ error: "Internal Server Error" });
});

// ---- Start server ----
const PORT = process.env.PORT || 5001;
app.listen(PORT, () =>
  console.log(
    `Server running on port ${PORT} (client origin: ${
      process.env.CLIENT_ORIGIN || "http://localhost:3000"
    })`
  )
);
