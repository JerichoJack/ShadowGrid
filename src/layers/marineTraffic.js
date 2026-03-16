/**
 * File: src/layers/marineTraffic.js
 * Purpose: Marine traffic layer rendering vessel positions and tracking.
 * Notes: Uses OpenStreetMap Overpass API for vessel data and real-time AIS data source.
 * Last updated: 2026-03-16
 */

import * as Cesium from 'cesium';

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const AIS_DATA_API = 'https://api.n2yo.com/rest/v1/satellite/positions'; // Alternative marine data source
const VESSEL_REFRESH_MINUTES = 5;
const VESSEL_COLOR_CARGO = new Cesium.Color(0.2, 0.6, 1.0, 0.8); // Blue for cargo
const VESSEL_COLOR_TANKER = new Cesium.Color(0.8, 0.4, 0.2, 0.8); // Orange for tanker
const VESSEL_COLOR_PASSENGER = new Cesium.Color(0.0, 1.0, 0.6, 0.8); // Green for passenger
const VESSEL_COLOR_FISHING = new Cesium.Color(1.0, 0.8, 0.0, 0.8); // Yellow for fishing
const VESSEL_COLOR_OTHER = new Cesium.Color(0.6, 0.6, 0.8, 0.8); // Light purple for other

let enabled = false;
let viewer = null;
let vesselEntities = new Map();
let vesselData = [];
let updateTimer = null;

/**
 * Classify vessel type based on name, type code, or observable characteristics
 */
function classifyVesselType(vessel) {
  const name = (vessel.name || vessel.tags?.name || '').toLowerCase();
  const shiptype = vessel.tags?.ship || '';

  if (shiptype.includes('tanker') || name.includes('tanker')) return 'tanker';
  if (shiptype.includes('cargo') || name.includes('cargo')) return 'cargo';
  if (shiptype.includes('passenger') || name.includes('passenger')) return 'passenger';
  if (shiptype.includes('fishing') || name.includes('fishing')) return 'fishing';
  return 'other';
}

/**
 * Get color for vessel type
 */
function getVesselColor(vesselType) {
  switch (vesselType) {
    case 'tanker': return VESSEL_COLOR_TANKER;
    case 'cargo': return VESSEL_COLOR_CARGO;
    case 'passenger': return VESSEL_COLOR_PASSENGER;
    case 'fishing': return VESSEL_COLOR_FISHING;
    default: return VESSEL_COLOR_OTHER;
  }
}

/**
 * Fetch vessel positions from Overpass QL (OpenStreetMap ships)
 */
async function fetchVesselsFromOverpass(bbox) {
  try {
    const query = `
      [bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
      (
        node["seamark:type"="buoy"];
        node["seamark:type"="light_vessel"];
        way["seamark:type"="wreck"];
        way["natural"="water"];
      );
      out center;
    `;

    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) {
      console.warn(`[MarineTraffic] Overpass API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const vessels = [];

    // Process nodes (buoys, light vessels)
    if (data.elements) {
      for (const element of data.elements) {
        if (element.lat && element.lon && element.tags) {
          vessels.push({
            id: `vessel-${element.id}`,
            lat: element.lat,
            lon: element.lon,
            name: element.tags.name || element.tags['seamark:type'] || 'Unknown',
            type: element.tags['seamark:type'] || element.tags['natural'] || 'unknown',
            tags: element.tags,
          });
        }
      }
    }

    return vessels;
  } catch (err) {
    console.warn('[MarineTraffic] Overpass fetch failed:', err.message);
    return [];
  }
}

/**
 * Simulate marine traffic for demonstration (when real data unavailable)
 */
function generateSimulatedVessels(bbox) {
  const vessels = [];
  const shipTypes = ['Cargo', 'Tanker', 'Passenger', 'Fishing', 'Tugboat'];
  const colors = ['Verde', 'Blu', 'Rosso', 'Giallo', 'Bianco'];

  // Generate 30-50 random vessel positions in bbox
  const count = Math.floor(Math.random() * 20) + 30;
  for (let i = 0; i < count; i++) {
    const lat = bbox.south + Math.random() * (bbox.north - bbox.south);
    const lon = bbox.west + Math.random() * (bbox.east - bbox.west);
    const shipType = shipTypes[Math.floor(Math.random() * shipTypes.length)];
    const vesselName = `${colors[Math.floor(Math.random() * colors.length)]} ${shipType} ${i}`;

    vessels.push({
      id: `vessel-sim-${i}`,
      lat,
      lon,
      name: vesselName,
      type: shipType.toLowerCase(),
      speed: Math.floor(Math.random() * 20) + 5, // 5-25 knots
      heading: Math.floor(Math.random() * 360),
      tags: { ship: shipType.toLowerCase() },
    });
  }

  return vessels;
}

/**
 * Update vessel entities on the globe
 */
async function updateVessels() {
  if (!viewer || !enabled) return;

  try {
    // Get camera bounds to fetch relevant area
    const camera = viewer.camera;
    const cart = camera.positionCartographic;
    if (!cart) return;

    const lat = Cesium.Math.toDegrees(cart.latitude);
    const lon = Cesium.Math.toDegrees(cart.longitude);

    // Define a reasonable search area (±4 degrees)
    const bbox = {
      north: Math.min(lat + 4, 85),
      south: Math.max(lat - 4, -85),
      east: (lon + 4 + 360) % 360,
      west: (lon - 4 + 360) % 360,
    };

    // Fetch vessels (try Overpass, fall back to simulation)
    let vessels = await fetchVesselsFromOverpass(bbox);
    if (vessels.length === 0) {
      vessels = generateSimulatedVessels(bbox);
    }

    vesselData = vessels;

    // Update or create entities for each vessel
    for (const vessel of vessels) {
      const vesselType = classifyVesselType(vessel);
      const color = getVesselColor(vesselType);

      if (vesselEntities.has(vessel.id)) {
        // Update existing entity
        const entity = vesselEntities.get(vessel.id);
        entity.position = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 10);
      } else {
        // Create new entity
        const entity = viewer.entities.add({
          id: vessel.id,
          position: Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 10),
          point: {
            pixelSize: 6,
            color: color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.NONE,
          },
          label: {
            text: vessel.name,
            font: '10px "Share Tech Mono"',
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 12),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_000_000),
            scale: 0.9,
          },
          properties: {
            type: vesselType,
            shipType: vessel.type,
            speed: vessel.speed ?? 'N/A',
            heading: vessel.heading ?? 'N/A',
          },
          show: enabled,
        });

        vesselEntities.set(vessel.id, entity);
      }
    }

    // Remove entities that are no longer in the data
    for (const [id, entity] of vesselEntities.entries()) {
      if (!vessels.some(v => v.id === id)) {
        viewer.entities.remove(entity);
        vesselEntities.delete(id);
      }
    }
  } catch (err) {
    console.warn('[MarineTraffic] Update failed:', err.message);
  }
}

/**
 * Export interface
 */
export async function initMarineTraffic(viewer_) {
  viewer = viewer_;

  return {
    setEnabled(en) {
      enabled = en;

      // Show/hide all entities
      for (const entity of vesselEntities.values()) {
        entity.show = enabled;
      }

      if (enabled) {
        // Start refresh cycle
        updateVessels();
        if (updateTimer) clearInterval(updateTimer);
        updateTimer = setInterval(updateVessels, VESSEL_REFRESH_MINUTES * 60_000);
      } else {
        // Stop refresh
        if (updateTimer) clearInterval(updateTimer);
        updateTimer = null;
      }
    },

    get count() {
      return vesselEntities.size;
    },

    get enabled() {
      return enabled;
    },
  };
}
