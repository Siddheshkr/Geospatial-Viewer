// server/routes/aoiRoutes.js
const express = require("express");
const { z } = require("zod");
const Aoi = require("../models/Aoi");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * Accept either:
 *  - a Feature object: { type: "Feature", geometry: { type: "Polygon"|"MultiPolygon", coordinates: [...]}, properties?: {} }
 *  - OR a direct geometry object: { type: "Polygon"|"MultiPolygon", coordinates: [...] }
 *
 * We'll validate using zod and perform extra safety checks.
 */

const coordPair = z.tuple([z.number(), z.number()]); // [lng, lat]
const ring = z.array(coordPair).min(4); // ring with at least 4 coords
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(ring),
});
const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ring)),
});
const pointSchema = z.object({
  type: z.literal("Point"),
  coordinates: coordPair,
});
const geometrySchema = z.union([polygonSchema, multiPolygonSchema, pointSchema]);

// Accept Feature, plain geometry, or a wrapper with top-level geometry
const featureOrGeometry = z.union([
  // GeoJSON Feature
  z.object({
    type: z.literal("Feature"),
    geometry: geometrySchema,
    properties: z.record(z.any()).optional(),
  }),
  // Plain geometry
  geometrySchema,
  // Wrapper { geometry, name?, description?, properties? }
  z.object({
    geometry: geometrySchema,
    name: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.any()).optional(),
  }),
]);

// Helper: ensure rings are closed (first == last)
function closeRings(geometry) {
  const ensureClosed = (ring) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  };

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => ensureClosed(ring));
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((poly) =>
      poly.forEach((ring) => ensureClosed(ring))
    );
  }
  return geometry;
}

// Lightweight Douglas-Peucker simplification for a single ring
function simplifyRing(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 4) return points;
  const sqTol = tolerance * tolerance;

  function getSqDist(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return dx * dx + dy * dy;
  }

  function getSqSegDist(p, p1, p2) {
    let x = p1[0];
    let y = p1[1];
    let dx = p2[0] - x;
    let dy = p2[1] - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2[0];
        y = p2[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  }

  function simplifyDP(points, first, last, sqTol, simplified) {
    let maxSqDist = sqTol;
    let index;

    for (let i = first + 1; i < last; i++) {
      const sqDist = getSqSegDist(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTol && index) {
      if (index - first > 1) simplifyDP(points, first, index, sqTol, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifyDP(points, index, last, sqTol, simplified);
    }
  }

  // ensure ring closed
  const first = points[0];
  const last = points[points.length - 1];
  const ring = first[0] === last[0] && first[1] === last[1] ? points : [...points, first];

  const simplified = [ring[0]];
  simplifyDP(ring, 0, ring.length - 1, sqTol, simplified);
  simplified.push(ring[ring.length - 1]);

  // keep at least 4 points (including closure)
  if (simplified.length < 4) return ring;
  return simplified;
}

function simplifyGeometry(geometry, toleranceDeg = 0.0001) {
  if (geometry.type === "Polygon") {
    geometry.coordinates = geometry.coordinates.map((ring) => simplifyRing(ring, toleranceDeg));
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates = geometry.coordinates.map((poly) =>
      poly.map((ring) => simplifyRing(ring, toleranceDeg))
    );
  }
  return geometry;
}

// Basic bounds check for coordinates (WGS84)
function coordsOutOfBounds(geometry) {
  const ok = (lng, lat) =>
    typeof lng === "number" &&
    typeof lat === "number" &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90;

  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    return !ok(lng, lat);
  } else if (geometry.type === "Polygon") {
    return geometry.coordinates.some((ring) =>
      ring.some(([lng, lat]) => !ok(lng, lat))
    );
  } else {
    return geometry.coordinates.some((poly) =>
      poly.some((ring) => ring.some(([lng, lat]) => !ok(lng, lat)))
    );
  }
}

/** POST /aoi — create AOI (auth required) */
router.post("/", requireAuth, async (req, res) => {
  try {
    const parsed = featureOrGeometry.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid GeoJSON", details: parsed.error.format() });
    }

    // Extract geometry
    let geometry;
    if (parsed.data.type === "Feature") {
      geometry = parsed.data.geometry;
    } else if (parsed.data.geometry) {
      geometry = parsed.data.geometry;
    } else {
      geometry = parsed.data;
    }

    // Close rings, simplify & validate coords
    closeRings(geometry);
    simplifyGeometry(geometry);
    if (coordsOutOfBounds(geometry)) {
      return res.status(400).json({ error: "Coordinates out of bounds" });
    }

    // Determine name/description from either wrapper body or feature properties
    const name =
      (parsed.data && parsed.data.properties && parsed.data.properties.name) ||
      req.body?.properties?.name ||
      req.body?.name ||
      "";

    const description =
      (parsed.data && parsed.data.properties && parsed.data.properties.description) ||
      req.body?.properties?.description ||
      req.body?.description ||
      "";

    // Save
    const doc = await Aoi.create({
      userId: req.userId,
      name,
      description,
      geometry,
    });

    return res.status(201).json(doc);
  } catch (err) {
    console.error("POST /aoi error:", {
      body: req.body, // 👈 log request body
      geometry: req.body.geometry,
      error: err, // full error object
    });
    return res.status(500).json({
      error: "Server error",
      details: err.message || "Unknown",
    });
  }
});

/**
 * GET /aoi
 * - returns AOIs belonging to user
 * - optional ?bbox=minLng,minLat,maxLng,maxLat to return only AOIs that intersect bbox
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const bbox = req.query.bbox; // "minLng,minLat,maxLng,maxLat"
    // Return both user's AOIs and public samples
    const query = { userId: { $in: [req.userId, "public"] } };

    if (bbox) {
      const parts = bbox.split(",").map(Number);
      if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) {
        return res.status(400).json({ error: "Invalid bbox parameter" });
      }
      const [minLng, minLat, maxLng, maxLat] = parts;

      // Build a polygon for the bbox and $geoIntersects
      query.geometry = {
        $geoIntersects: {
          $geometry: {
            type: "Polygon",
            coordinates: [
              [
                [minLng, minLat],
                [maxLng, minLat],
                [maxLng, maxLat],
                [minLng, maxLat],
                [minLng, minLat],
              ],
            ],
          },
        },
      };
    }

    const items = await Aoi.find(query).sort({ createdAt: -1 }).lean();
    return res.json(items);
  } catch (err) {
    console.error("GET /aoi error:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: String(err.message || err) });
  }
});

module.exports = router;
