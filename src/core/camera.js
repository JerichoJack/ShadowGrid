/**
 * File: src/core/camera.js
 * Purpose: Initializes startup camera position and exposes shared camera helpers.
 * Notes: Supports optional IP-based startup geolocation with env fallbacks.
 * Last updated: 2026-03-13
 */

import * as Cesium from 'cesium';

const DEFAULT_LON      = parseFloat(import.meta.env.VITE_DEFAULT_LON ?? '-97.7431');
const DEFAULT_LAT      = parseFloat(import.meta.env.VITE_DEFAULT_LAT ?? '30.2672');
const DEFAULT_ALT      = parseFloat(import.meta.env.VITE_DEFAULT_ALT ?? '150000');
const USE_IP_LOCATION  = (import.meta.env.VITE_DEFAULT_USE_IP_LOCATION ?? 'true') !== 'false';

// ── IP geolocation ────────────────────────────────────────────────────────────
// Tries ipapi.co (free, no key), falls back to env defaults.
// Skipped entirely when VITE_DEFAULT_USE_IP_LOCATION=false.

async function getStartupLocation() {
  if (!USE_IP_LOCATION) {
    console.info(`[Camera] IP location disabled — using default (${DEFAULT_LAT.toFixed(2)}, ${DEFAULT_LON.toFixed(2)})`);
    return { lon: DEFAULT_LON, lat: DEFAULT_LAT };
  }
  try {
    const res = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`ipapi ${res.status}`);
    const d = await res.json();
    if (d.latitude && d.longitude) {
      console.info(`[Camera] IP location: ${d.city ?? ''}, ${d.country_name ?? ''} (${d.latitude.toFixed(2)}, ${d.longitude.toFixed(2)})`);
      return { lon: d.longitude, lat: d.latitude };
    }
  } catch (err) {
    console.warn('[Camera] IP geolocation failed, using defaults:', err.message);
  }
  return { lon: DEFAULT_LON, lat: DEFAULT_LAT };
}

export async function initCamera(viewer) {
  const camera = viewer.camera;

  // ── Initial position — IP location or hardcoded default ─────────────────
  const { lon, lat } = await getStartupLocation();

  camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, DEFAULT_ALT),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch:   Cesium.Math.toRadians(-90),
      roll:    0.0,
    },
    duration: 3.0,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });

  // Coord readouts are now owned entirely by HUD.js — nothing to wire here.
  return camera;
}

/**
 * Fly the camera to a named city or explicit coordinates.
 * @param {Cesium.Viewer} viewer
 * @param {{ lon: number, lat: number, alt?: number, heading?: number, pitch?: number }} opts
 */
export function flyTo(viewer, { lon, lat, alt = 1500, heading = 0, pitch = -90 }) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
    orientation: {
      heading: Cesium.Math.toRadians(heading),
      pitch:   Cesium.Math.toRadians(pitch),
      roll:    0,
    },
    duration: 2.5,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
  });
}

/** Named city presets */
export const CITIES = {
  austin:  { lon: -97.7431, lat: 30.2672, alt:  8000 },
  london:  { lon:  -0.1276, lat: 51.5074, alt:  8000 },
  nyc:     { lon: -74.0060, lat: 40.7128, alt:  8000 },
  tokyo:   { lon: 139.6917, lat: 35.6895, alt:  8000 },
  dubai:   { lon:  55.2708, lat: 25.2048, alt:  8000 },
  globe:   { lon:   0,      lat: 20,      alt: 20_000_000 },
};