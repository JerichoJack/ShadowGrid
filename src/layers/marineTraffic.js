/**
 * File: src/layers/marineTraffic.js
 * Purpose: Marine traffic layer rendering vessel positions and tracking.
 * Notes: Uses local proxy snapshots for cached marine vessel data in both normal and server-heavy modes.
 * Last updated: 2026-03-16
 */

import * as Cesium from 'cesium';
import { setServerSnapshotLayerEnabled, subscribeServerSnapshot } from '../core/serverSnapshot.js';

const SERVER_HEAVY_MODE = (import.meta.env.VITE_SERVER_HEAVY_MODE ?? 'false').toLowerCase() === 'true';
const MARINE_SNAPSHOT_URL = '/api/localproxy/api/marine/snapshot';
const VESSEL_REFRESH_MS = 60_000;
const TRACK_MAX_POINTS = 12;
const VESSEL_COLOR_CARGO = new Cesium.Color(0.2, 0.6, 1.0, 0.8); // Blue for cargo
const VESSEL_COLOR_TANKER = new Cesium.Color(0.8, 0.4, 0.2, 0.8); // Orange for tanker
const VESSEL_COLOR_PASSENGER = new Cesium.Color(0.0, 1.0, 0.6, 0.8); // Green for passenger
const VESSEL_COLOR_FISHING = new Cesium.Color(1.0, 0.8, 0.0, 0.8); // Yellow for fishing

const VESSEL_COLOR_OTHER = new Cesium.Color(0.6, 0.6, 0.8, 0.8); // Light purple for other

const SHIP_SVG_SHAPES = {
  cargo: {
    // flat hull + stacked containers
    path: 'M3 24 L29 24 L25 28 L7 28 Z M6 18 H12 V24 H6 Z M13 18 H19 V24 H13 Z M20 18 H26 V24 H20 Z',
    accent: 'M3 24 H29',
    viewBox: '0 0 32 32',
  },

  tanker: {
    // long rounded hull + central tank dome
    path: 'M4 25 Q16 20 28 25 L24 28 H8 Z M12 17 Q16 14 20 17 Q16 19 12 17 Z',
    accent: 'M6 25 Q16 22 26 25',
    viewBox: '0 0 32 32',
  },

  passenger: {
    // cruise ship: tiered decks + bridge
    path: 'M3 26 L29 26 L24 28 L8 28 Z M8 18 H24 V22 H8 Z M10 14 H22 V18 H10 Z',
    accent: 'M10 20 H22',
    viewBox: '0 0 32 32',
  },

  fishing: {
    // small boat + mast
    path: 'M6 26 L26 26 L20 28 L12 28 Z M15 14 L17 14 L17 24 L15 24 Z M16 14 L22 20 L16 20 Z',
    accent: 'M16 24 L16 28',
    viewBox: '0 0 32 32',
  },

  other: {
    // generic but still "boat-like"
    path: 'M6 26 L26 26 L21 28 L11 28 Z M12 20 H20 V24 H12 Z',
    accent: '',
    viewBox: '0 0 32 32',
  },
};


function buildShipSvgUri(type, color) {
  const shape = SHIP_SVG_SHAPES[type] || SHIP_SVG_SHAPES.other;
  const fill = color.toCssColorString();
  const stroke = '#222';
  const sw = 2;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${shape.viewBox}" width="32" height="32">`;
  svg += `<path fill="${fill}" stroke="${stroke}" stroke-width="${sw}" d="${shape.path}"/>`;
  if (shape.accent) {
    svg += `<path fill="none" stroke="#fff" stroke-width="1" d="${shape.accent}"/>`;
  }
  svg += '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

let enabled = false;
let viewer = null;
let vesselEntities = new Map(); // id -> { point: Entity, track: Entity, trail: Array<{lat:number, lon:number}> }
let updateTimer = null;

/**
 * Classify vessel type based on name, type code, or observable characteristics
 */
function classifyVesselType(vessel) {
  const name = (vessel.name || vessel.tags?.name || '').toLowerCase();
  const shiptype = String(vessel.type || vessel.tags?.ship || vessel.tags?.['ship:type'] || '').toLowerCase();

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
 * Compute current viewport bounds for proxy requests.
 */
function getViewportBounds() {
  if (!viewer) return null;

  const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;

  return {
    west: Cesium.Math.toDegrees(rectangle.west),
    south: Cesium.Math.toDegrees(rectangle.south),
    east: Cesium.Math.toDegrees(rectangle.east),
    north: Cesium.Math.toDegrees(rectangle.north),
  };
}

function buildMarineSnapshotUrl(bounds) {
  if (!bounds) return MARINE_SNAPSHOT_URL;
  const boundsStr = [bounds.west, bounds.south, bounds.east, bounds.north]
    .map(v => Number(v).toFixed(6))
    .join(',');
  return `${MARINE_SNAPSHOT_URL}?bounds=${encodeURIComponent(boundsStr)}`;
}

async function fetchVesselsFromProxy() {
  const bounds = getViewportBounds();
  if (!bounds) return [];

  try {
    const response = await fetch(buildMarineSnapshotUrl(bounds));

    if (!response.ok) {
      console.warn(`[MarineTraffic] Proxy API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data?.vessels) ? data.vessels : [];
  } catch (err) {
    console.warn('[MarineTraffic] Proxy fetch failed:', err.message);
    return [];
  }
}

/**
 * Build/update a vessel trail list from either server-provided track or prior positions.
 */
function resolveTrack(vessel, existingTrail = []) {
  if (Array.isArray(vessel.track) && vessel.track.length >= 2) {
    return vessel.track
      .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
      .slice(-TRACK_MAX_POINTS);
  }

  const trail = [...existingTrail, { lat: vessel.lat, lon: vessel.lon }];
  return trail.slice(-TRACK_MAX_POINTS);
}

/**
 * Render/update vessel entities and track polylines.
 */
function applyVesselSnapshot(vessels = []) {
  if (!viewer) return;

  try {
    const seen = new Set();

    for (const vessel of vessels) {
      if (!Number.isFinite(vessel?.lat) || !Number.isFinite(vessel?.lon)) continue;
      const vesselId = String(vessel.id ?? `${vessel.name ?? 'vessel'}-${vessel.lat}-${vessel.lon}`);
      seen.add(vesselId);

      const vesselType = classifyVesselType(vessel);
      const color = getVesselColor(vesselType);
      const track = resolveTrack(vessel, vesselEntities.get(vesselId)?.trail ?? []);
      const trackPositions = track.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 8));

      if (vesselEntities.has(vesselId)) {
        const record = vesselEntities.get(vesselId);
        record.point.position = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 10);
        record.point.billboard.image = buildShipSvgUri(vesselType, color);
        record.point.billboard.color = color;
        record.point.label.text = vessel.name || vesselId;
        record.point.label.fillColor = color;
        record.point.properties = new Cesium.PropertyBag({
          type: vesselType,
          shipType: vessel.type,
          speed: vessel.speed ?? 'N/A',
          heading: vessel.heading ?? 'N/A',
          source: vessel.simulated ? 'simulated' : 'live',
        });
        record.track.polyline.positions = trackPositions;
        record.track.polyline.material = color.withAlpha(0.35);
        record.track.show = enabled;
        record.trail = track;
      } else {
        const pointEntity = viewer.entities.add({
          id: `marine-point-${vesselId}`,
          position: Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 10),
          billboard: {
            image: buildShipSvgUri(vesselType, color),
            color: color,
            scale: 1.0,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.NONE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            eyeOffset: new Cesium.Cartesian3(0, 0, 0),
          },
          label: {
            text: vessel.name || vesselId,
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
            source: vessel.simulated ? 'simulated' : 'live',
          },
          show: enabled,
        });

        const trackEntity = viewer.entities.add({
          id: `marine-track-${vesselId}`,
          polyline: {
            positions: trackPositions,
            width: 2,
            material: color.withAlpha(0.35),
            clampToGround: false, // Not clamped, so outline is fine
            arcType: Cesium.ArcType.GEODESIC,
          },
          show: enabled,
        });

        vesselEntities.set(vesselId, {
          point: pointEntity,
          track: trackEntity,
          trail: track,
        });
      }
    }

    for (const [id, record] of vesselEntities.entries()) {
      if (!seen.has(id)) {
        viewer.entities.remove(record.point);
        viewer.entities.remove(record.track);
        vesselEntities.delete(id);
      }
    }
  } catch (err) {
    console.warn('[MarineTraffic] Snapshot apply failed:', err.message);
  }
}

async function refreshMarineSnapshot() {
  if (!viewer || !enabled || SERVER_HEAVY_MODE) return;
  const vessels = await fetchVesselsFromProxy();
  applyVesselSnapshot(vessels);
}

function setEntityVisibility(show) {
  for (const record of vesselEntities.values()) {
    record.point.show = show;
    record.track.show = show;
  }
}

/**
 * Export interface
 */
export async function initMarineTraffic(viewer_) {
  viewer = viewer_;


  // No custom click handler: HUD entity picker will handle vessel clicks

  if (SERVER_HEAVY_MODE) {
    subscribeServerSnapshot('marine', {
      onData(payload) {
        if (!enabled) return;
        applyVesselSnapshot(payload?.marine?.vessels ?? []);
      },
      onError(err) {
        if (!enabled) return;
        console.warn('[MarineTraffic] Server snapshot failed:', err?.message ?? 'unknown');
      },
    });
  }

  return {
    async setEnabled(en) {
      enabled = en;
      setEntityVisibility(enabled);

      if (enabled) {
        if (SERVER_HEAVY_MODE) {
          setServerSnapshotLayerEnabled('marine', true);
          return;
        }

        await refreshMarineSnapshot();
        if (updateTimer) clearInterval(updateTimer);
        updateTimer = setInterval(() => {
          refreshMarineSnapshot();
        }, VESSEL_REFRESH_MS);
      } else {
        setServerSnapshotLayerEnabled('marine', false);
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
