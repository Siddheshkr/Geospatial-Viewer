"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

export default function MapViewer() {
  // 1. Clerk hooks must come first
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();

  // 2. Ref initialized with current values
  const authRef = useRef({ isSignedIn, isLoaded });

  // 3. Keep ref updated when auth state changes
  useEffect(() => {
    authRef.current = { isSignedIn, isLoaded };
  }, [isSignedIn, isLoaded]);

  // other refs & state
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const [featureInfo, setFeatureInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState("checking"); // 'checking', 'connected', 'disconnected'

  // Effect to check server status on mount and periodically
  useEffect(() => {
    const checkServer = async () => {
      const healthy = await checkServerHealth();
      setServerStatus(healthy ? "connected" : "disconnected");
    };

    // Check immediately
    checkServer();

    // Check every 30 seconds
    const interval = setInterval(checkServer, 30000);

    return () => clearInterval(interval);
  }, []);

  // Function to check if server is running
  const checkServerHealth = async () => {
    try {
      const healthUrl = `${
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001"
      }/health`;
      console.log("Checking server health at:", healthUrl);

      const res = await fetch(healthUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        const data = await res.json();
        console.log("Server health check passed:", data);
        return true;
      } else {
        console.error("Server health check failed:", res.status);
        return false;
      }
    } catch (err) {
      console.error("Server health check error:", err);
      return false;
    }
  };

  // Function to load saved AOIs
  const loadSavedAOIs = useCallback(async () => {
    if (!isSignedIn || !isLoaded || !mapRef.current) return;

    try {
      // Check server health first
      const serverHealthy = await checkServerHealth();
      if (!serverHealthy) {
        console.error(
          "Server is not responding. Please ensure the server is running on http://localhost:5001"
        );
        return;
      }

      const token = await getToken();
      console.log("Token obtained for AOI loading:", token ? "Yes" : "No");

      if (!token) {
        console.error("No token available for AOI loading");
        return;
      }

      // Include bbox of current view to fetch only visible features
      const bounds = mapRef.current.getBounds();
      const bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ].join(",");
      const aoiUrl = `${
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001"
      }/aoi?bbox=${encodeURIComponent(bbox)}`;
      console.log("Attempting to load AOIs from:", aoiUrl);

      const res = await fetch(aoiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error(
          "Server response for AOI loading:",
          res.status,
          errorData
        );
        throw new Error(
          `Failed to fetch AOIs: ${res.status} ${errorData.error || ""}`
        );
      }

      const aois = await res.json();
      console.log("AOIs loaded:", aois.length);

      if (aois.length === 0) {
        console.log("No saved AOIs found for this user (including public samples)");
        return;
      }

      // Clear existing AOIs and add new ones
      let drawnItems = mapRef.current.featureGroup;
      if (!drawnItems && mapRef.current) {
        const L = require("leaflet");
        drawnItems = new L.FeatureGroup().addTo(mapRef.current);
        mapRef.current.featureGroup = drawnItems;
      }
      if (drawnItems) drawnItems.clearLayers();

      aois.forEach((aoi) => {
        try {
          const L = require("leaflet");
          const geoJsonLayer = L.geoJSON(aoi.geometry, {
            style: {
              color: "#ff7800",
              weight: 2,
              opacity: 0.8,
              fillOpacity: 0.2,
            },
            onEachFeature: (feature, layer) => {
              layer.bindPopup(`
                <div class="p-2">
                  <h3 class="font-bold">${aoi.name || "Unnamed AOI"}</h3>
                  ${
                    aoi.description
                      ? `<p class="text-sm text-gray-600">${aoi.description}</p>`
                      : ""
                  }
                  <p class="text-xs text-gray-500">Created: ${new Date(
                    aoi.createdAt
                  ).toLocaleDateString()}</p>
                </div>
              `);
            },
          });
          if (drawnItems) drawnItems.addLayer(geoJsonLayer);
          else geoJsonLayer.addTo(mapRef.current);
        } catch (err) {
          console.error("Error rendering AOI:", aoi._id, err);
        }
      });
    } catch (err) {
      console.error("Error loading AOIs:", err);

      // Provide specific error messages based on error type
      if (err.name === "TypeError" && err.message.includes("Failed to fetch")) {
        console.error(
          "Network error: Cannot connect to server. Please ensure the server is running on http://localhost:5001"
        );
      } else if (err.message.includes("JWT template")) {
        console.log("JWT template error - user may need to re-authenticate");
      } else {
        console.error("Error loading AOIs:", err.message);
      }
    }
  }, [isSignedIn, isLoaded, getToken]);

  // Reload AOIs when map view changes (debounced)
  useEffect(() => {
    if (!mapRef.current) return;
    let timer;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        loadSavedAOIs();
      }, 400);
    };
    mapRef.current.on("moveend", handler);
    return () => {
      clearTimeout(timer);
      if (mapRef.current) mapRef.current.off("moveend", handler);
    };
  }, [isSignedIn, isLoaded, loadSavedAOIs]);

  // Removed client-side seeding; server returns public samples

  // Debug authentication state
  useEffect(() => {
    console.log("Auth state changed:", {
      isLoaded,
      isSignedIn,
      user: user?.id,
      userEmail: user?.emailAddresses?.[0]?.emailAddress,
    });
  }, [isLoaded, isSignedIn, user]);

  // Effect to load AOIs when authentication state changes
  useEffect(() => {
    if (isSignedIn && isLoaded && mapRef.current) {
      console.log("Auth state changed, loading AOIs...");
      loadSavedAOIs();
    }
  }, [isSignedIn, isLoaded, loadSavedAOIs]);

  useEffect(() => {
    let L;
    let map;

    async function initializeMap() {
      try {
        // Wait for the DOM element to be available
        const mapContainer = document.getElementById("map");
        if (!mapContainer) {
          console.log("Map container not found, retrying...");
          // Retry after a short delay
          setTimeout(initializeMap, 100);
          return;
        }

        // Import Leaflet
        const leaflet = await import("leaflet");
        L = leaflet.default || leaflet;

        // Import Leaflet Draw
        await import("leaflet-draw");

        if (mapRef.current) return;

        // Initialize map
        map = L.map("map", {
          center: [23.7, 91.6],
          zoom: 9,
          crs: L.CRS.EPSG3857,
        });
        mapRef.current = map;

        // Add error handling for map initialization
        map.on("error", (error) => {
          console.error("Map error:", error);
        });

        // ---- Base Layer ----
        layersRef.current.osm = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          { attribution: "&copy; OpenStreetMap contributors" }
        ).addTo(map);

        // ---- WMS Overlays ----
        const WMS_URL = "https://geoserver01.haketech.com/geoserver/wms";

        layersRef.current.boundary = L.tileLayer
          .wms(WMS_URL, {
            layers: "tripura:tripura_gpvc_boundary",
            format: "image/png",
            transparent: true,
            opacity: 1,
            version: "1.1.1",
          })
          .addTo(map);

        layersRef.current.drainage = L.tileLayer
          .wms(WMS_URL, {
            layers: "tripura:tripura_drainage",
            format: "image/png",
            transparent: true,
            opacity: 1,
            version: "1.1.1",
          })
          .addTo(map);

        // Add error handling for WMS layers
        Object.values(layersRef.current).forEach((layer) => {
          if (layer.on) {
            layer.on("loading", () => console.log("Layer loading..."));
            layer.on("load", () => console.log("Layer loaded"));
            layer.on("tileerror", (error) =>
              console.error("Tile error:", error)
            );
          }
        });

        const baseLayers = { OpenStreetMap: layersRef.current.osm };
        const overlayLayers = {
          "Tripura Boundary": layersRef.current.boundary,
          "Tripura Drainage": layersRef.current.drainage,
        };

        // ---- Layer Control ----
        const control = L.control
          .layers(baseLayers, overlayLayers, { collapsed: true })
          .addTo(map);

        // ---- Opacity sliders for overlays ----
        Object.entries(overlayLayers).forEach(([name, layer]) => {
          const sliderContainer = L.DomUtil.create(
            "div",
            "flex items-center justify-between text-xs text-gray-700 my-1"
          );
          const label = L.DomUtil.create("span", "", sliderContainer);
          label.innerText = name;

          const input = L.DomUtil.create(
            "input",
            "ml-2 w-24 accent-blue-600 cursor-pointer",
            sliderContainer
          );
          input.type = "range";
          input.min = "0";
          input.max = "1";
          input.step = "0.05";
          input.value = layer.options.opacity;

          input.addEventListener("input", (e) =>
            layer.setOpacity(parseFloat(e.target.value))
          );

          control._overlaysList.appendChild(sliderContainer);
        });

        // ---- Draw AOI ----
        const drawnItems = new L.FeatureGroup().addTo(map);
        mapRef.current.featureGroup = drawnItems;
        const drawControl = new L.Control.Draw({
          draw: { polygon: true, circle: true, marker: true },
          edit: { featureGroup: drawnItems },
        });
        map.addControl(drawControl);

        // ---- Handle Created Polygons ----
        map.on(L.Draw.Event.CREATED, async (e) => {
          const { isSignedIn: signedInNow, isLoaded: loadedNow } =
            authRef.current;
          if (!signedInNow || !loadedNow) {
            alert("Please sign in to save Areas of Interest");
            return;
          }

          const layer = e.layer;
          let geojson = layer.toGeoJSON();
          drawnItems.addLayer(layer);

          // Ensure polygon ring is closed. Leaflet outputs valid GeoJSON with [lng, lat]
          if (geojson.geometry?.type === "Polygon") {
            const ring = geojson.geometry.coordinates?.[0] || [];
            if (ring.length >= 1) {
              const first = ring[0];
              const last = ring[ring.length - 1];
              if (first[0] !== last[0] || first[1] !== last[1]) {
                geojson.geometry.coordinates[0] = [...ring, first];
              }
            }
          }

          // Convert Circle to Polygon approximation (GeoJSON-friendly)
          if (e.layerType === "circle" && layer.getLatLng && layer.getRadius) {
            const center = layer.getLatLng();
            const radiusMeters = layer.getRadius();
            const steps = 64;
            const coords = [];
            for (let i = 0; i < steps; i++) {
              const angle = (i / steps) * 2 * Math.PI;
              const dx = (radiusMeters * Math.cos(angle)) / 111320; // deg per meter approx for lng at equator
              const dy = (radiusMeters * Math.sin(angle)) / 110540; // deg per meter approx for lat
              const lng = center.lng + dx / Math.cos((center.lat * Math.PI) / 180);
              const lat = center.lat + dy;
              coords.push([lng, lat]);
            }
            // close ring
            coords.push(coords[0]);
            geojson = {
              type: "Feature",
              properties: { shape: "circle", radius: radiusMeters },
              geometry: { type: "Polygon", coordinates: [coords] },
            };
          }

          const name =
            prompt("Enter a name for this Area of Interest (optional):") ||
            "Unnamed AOI";
          const description = prompt("Enter a description (optional):") || "";

          try {
            setIsLoading(true);
            const token = await getToken();
            if (!token) throw new Error("Authentication token not available");

            const apiUrl = `${
              process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001"
            }/aoi`;

            console.log("Sending AOI to server:", {
              name,
              description,
              geometry: geojson.geometry,
            });

            const res = await fetch(apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                name,
                description,
                geometry: geojson.geometry, // backend accepts wrapper { geometry, ... }
              }),
            });

            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              console.error("Server response error:", res.status, errorData);
              throw new Error(
                `Server error: ${res.status} - ${
                  errorData.error || errorData.message || "Unknown error"
                }`
              );
            }

            const data = await res.json();
            console.log("AOI saved successfully:", data);
            // Bind popup to created layer
            try {
              layer.bindPopup(`
                <div class="p-2">
                  <h3 class="font-bold">${name || "Unnamed AOI"}</h3>
                  ${
                    description
                      ? `<p class="text-sm text-gray-600">${description}</p>`
                      : ""
                  }
                </div>
              `);
            } catch (_) {}
            alert("AOI saved successfully!");
          } catch (err) {
            console.error("Error saving AOI:", err);
            alert("Error saving AOI: " + err.message);
          } finally {
            setIsLoading(false);
          }
        });

        // ---- Map click handler for GetFeatureInfo ----
        map.on("click", async (e) => {
          const { isSignedIn, isLoaded } = authRef.current;
          console.log("Map clicked, checking auth state:", {
            isSignedIn,
            isLoaded,
          });

          if (!isSignedIn || !isLoaded) {
            alert("Please sign in to view feature information");
            return;
          }

          const point = map.latLngToContainerPoint(e.latlng);
          const size = map.getSize();
          const bbox = map.getBounds().toBBoxString();

          const activeLayers = [];
          if (
            layersRef.current.boundary &&
            map.hasLayer(layersRef.current.boundary)
          ) {
            activeLayers.push("tripura:tripura_gpvc_boundary");
          }
          if (
            layersRef.current.drainage &&
            map.hasLayer(layersRef.current.drainage)
          ) {
            activeLayers.push("tripura:tripura_drainage");
          }

          if (activeLayers.length === 0) {
            alert(
              "No WMS layers are currently visible. Please enable at least one layer to get feature information."
            );
            return;
          }

          try {
            setIsLoading(true);

            const serverHealthy = await checkServerHealth();
            if (!serverHealthy) throw new Error("Server not responding");

            const params = new URLSearchParams({
              x: Math.round(point.x).toString(),
              y: Math.round(point.y).toString(),
              bbox,
              width: size.x.toString(),
              height: size.y.toString(),
              layers: activeLayers.join(","),
            });

            const wmsUrl = `${
              process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001"
            }/wms/feature-info?${params}`;
            console.log("Attempting to fetch feature info from:", wmsUrl);

            const res = await fetch(wmsUrl);
            const raw = await res.text();
            console.log("Raw response text:", raw);

            let data;
            try {
              data = JSON.parse(raw);
            } catch (err) {
              throw new Error(
                "Server returned non-JSON response: " + raw.slice(0, 200)
              );
            }

            console.log("Feature info received:", data);

            if (data.features && data.features.length > 0) {
              setFeatureInfo({
                latlng: e.latlng,
                data: data.features,
                layers: activeLayers,
              });
            } else {
              alert("No features found at this location.");
            }
          } catch (err) {
            console.error("Error fetching feature info:", err);
            alert("Error fetching feature information: " + err.message);
          } finally {
            setIsLoading(false);
          }
        });

        // ---- Load saved AOIs ----
        // This function is now handled by the useEffect hook
      } catch (error) {
        console.error("Error initializing map:", error);
        // Show user-friendly error message
        const mapContainer = document.getElementById("map");
        if (mapContainer) {
          mapContainer.innerHTML = `
            <div class="flex items-center justify-center h-full bg-red-50 border-2 border-red-200 rounded-lg">
              <div class="text-center p-6">
                <h3 class="text-lg font-semibold text-red-800 mb-2">Map Loading Error</h3>
                <p class="text-red-600 mb-4">Failed to initialize the map. Please refresh the page and try again.</p>
                <button onclick="window.location.reload()" class="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
                  Refresh Page
                </button>
              </div>
            </div>
          `;
        }
      }
    }

    // Initialize map after a short delay to ensure DOM is ready
    const timer = setTimeout(initializeMap, 100);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [getToken, isSignedIn, isLoaded, loadSavedAOIs]);

  // Debug information
  console.log("Clerk loaded:", isLoaded);
  console.log("User signed in:", isSignedIn);
  console.log("User object:", user);
  console.log("getToken function available:", !!getToken);

  // Don't render anything until Clerk is loaded
  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div id="map" className="w-full h-full z-10" />

      {/* Feature Info Popup */}
      {featureInfo && (
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-sm max-h-96 overflow-y-auto z-50">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-gray-800">Feature Information</h3>
            <button
              onClick={() => setFeatureInfo(null)}
              className="text-gray-500 hover:text-gray-700 text-xl font-bold"
            >
              ×
            </button>
          </div>

          <div className="text-sm text-gray-600 mb-2">
            <p>Lat: {featureInfo.latlng.lat.toFixed(6)}</p>
            <p>Lng: {featureInfo.latlng.lng.toFixed(6)}</p>
            <p>Layers: {featureInfo.layers.join(", ")}</p>
          </div>

          <div className="space-y-2">
            {featureInfo.data.map((feature, index) => (
              <div key={index} className="border-t pt-2">
                <h4 className="font-semibold text-gray-700">
                  {feature.properties?.name || `Feature ${index + 1}`}
                </h4>
                {feature.properties && (
                  <div className="text-xs text-gray-600 mt-1">
                    {Object.entries(feature.properties).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="font-medium">{key}:</span>
                        <span>{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute top-4 left-4 bg-blue-500 text-white px-3 py-2 rounded-lg shadow-lg z-50">
          Loading feature info...
        </div>
      )}

      {/* Instructions */}
      {!isSignedIn && (
        <div className="absolute top-4 left-4 bg-yellow-100 border border-yellow-300 text-yellow-800 px-4 py-2 rounded-lg shadow-lg z-50">
          Sign in to save Areas of Interest and view feature information
        </div>
      )}

      {/* Authentication Status Indicator */}
      {isSignedIn && (
        <div className="absolute top-4 left-4 bg-green-100 border border-green-300 text-green-800 px-4 py-2 rounded-lg shadow-lg z-50">
          ✓ Signed in as{" "}
          {user?.emailAddresses?.[0]?.emailAddress || user?.id || "User"}
        </div>
      )}

      {/* Server Status Indicator */}
      <div
        className={`absolute top-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50 ${
          serverStatus === "connected"
            ? "bg-green-100 border border-green-300 text-green-800"
            : serverStatus === "disconnected"
            ? "bg-red-100 border border-red-300 text-red-800"
            : "bg-yellow-100 border border-yellow-300 text-yellow-800"
        }`}
      >
        <div className="flex items-center gap-2">
          {serverStatus === "connected" && "✓ Server Connected"}
          {serverStatus === "disconnected" && (
            <>
              <span>✗ Server Disconnected</span>
              <button
                onClick={async () => {
                  setServerStatus("checking");
                  const healthy = await checkServerHealth();
                  setServerStatus(healthy ? "connected" : "disconnected");
                }}
                className="text-xs bg-red-200 hover:bg-red-300 px-2 py-1 rounded"
              >
                Retry
              </button>
            </>
          )}
          {serverStatus === "checking" && "⟳ Checking Server..."}
        </div>
      </div>

      {/* Debug info for development */}
      {process.env.NODE_ENV === "development" && (
        <div className="absolute bottom-4 left-4 bg-gray-800 text-white p-2 rounded text-xs z-50">
          <div>Auth: {isSignedIn ? "Signed In" : "Signed Out"}</div>
          <div>Map: {mapRef.current ? "Loaded" : "Not Loaded"}</div>
          <div>User: {user?.id ? "Yes" : "No"}</div>
          <div>Server: {serverStatus}</div>
        </div>
      )}
    </div>
  );
}
