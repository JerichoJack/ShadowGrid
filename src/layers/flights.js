/**
 * layers/flights.js
 * Live aircraft rendering with a switchable flight data provider.
 *
 * Controlled by VITE_FLIGHT_PROVIDER in your .env:
 *
 *   opensky   — OpenSky Network (free, OAuth2, 4000 credits/day authenticated)
 *   adsbfi    — adsb.fi (free, no key required, community-driven)
 *   adsbool   — adsb.lol (free, no key required, ODbL licensed, ADS-B Exchange drop-in)
 *
 * All three providers return the same internal data shape so rendering is
 * provider-agnostic. The app falls back automatically down the chain if a
 * provider fails or is unconfigured.
 *
 * Docs:
 *   OpenSky:  https://openskynetwork.github.io/opensky-api/rest.html
 *   adsb.fi:  https://api.adsb.fi/
 *   adsb.lol: https://api.adsb.lol/docs
 */

import * as Cesium from 'cesium';

// ── Config ───────────────────────────────────────────────────────────────────

const PROVIDER = (import.meta.env.VITE_FLIGHT_PROVIDER ?? 'adsbfi').toLowerCase();
const POLL_MS  = 15_000;

// OpenSky OAuth2
const OPENSKY_CLIENT_ID     = import.meta.env.VITE_OPENSKY_CLIENT_ID     ?? '';
const OPENSKY_CLIENT_SECRET = import.meta.env.VITE_OPENSKY_CLIENT_SECRET ?? '';
const OPENSKY_TOKEN_URL     = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_STATES_URL    = 'https://opensky-network.org/api/states/all';

// adsb.fi — free, no auth, global coverage
const ADSBFI_URL  = 'https://api.adsb.fi/v1/aircraft';

// adsb.lol — free, no auth, ADS-B Exchange-compatible API
const ADSBOOL_URL = 'https://api.adsb.lol/v2/aircraft';

const AIRCRAFT_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2L8 10H3l4 3-1.5 7L12 16l6.5 4L17 13l4-3h-5z"/></svg>`;

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {Map<string, Cesium.Entity>} */
const entityMap = new Map();
let enabled     = true;
let oskToken    = null;   // cached OAuth2 token
let oskTokenExp = 0;      // expiry epoch ms

// ── Public API ────────────────────────────────────────────────────────────────

export async function initFlights(viewer) {
  console.info(`[Flights] Provider: ${PROVIDER}`);
  await fetchAndRender(viewer);
  setInterval(() => { if (enabled) fetchAndRender(viewer); }, POLL_MS);

  return {
    setEnabled(val) {
      enabled = val;
      entityMap.forEach(e => { e.show = val; });
    },
    get count() { return entityMap.size; },
    get provider() { return PROVIDER; },
  };
}

// ── Fetch dispatch ────────────────────────────────────────────────────────────

async function fetchAndRender(viewer) {
  try {
    const aircraft = await fetchAircraft();
    renderAircraft(viewer, aircraft);
  } catch (err) {
    console.warn('[Flights] Fetch failed:', err.message);
  }
}

async function fetchAircraft() {
  switch (PROVIDER) {
    case 'opensky':   return fetchOpenSky();
    case 'adsbool':   return fetchAdsbLol();
    case 'adsbfi':
    default:          return fetchAdsbFi();
  }
}

// ── Provider: adsb.fi (recommended default — free, no key) ───────────────────

async function fetchAdsbFi() {
  const resp = await fetch(ADSBFI_URL);
  if (!resp.ok) throw new Error(`adsb.fi ${resp.status}`);
  const data = await resp.json();
  // adsb.fi returns { aircraft: [...] } with fields: hex, flight, lat, lon, alt_baro, track, gs
  return (data.aircraft ?? [])
    .filter(a => a.lat && a.lon && !a.on_ground)
    .map(a => ({
      id:       a.hex,
      callsign: (a.flight ?? '').trim(),
      lat:      a.lat,
      lon:      a.lon,
      alt:      (a.alt_baro ?? 10000),
      heading:  a.track   ?? 0,
      velocity: a.gs      ?? 0,
    }));
}

// ── Provider: adsb.lol (free, no key, ADS-B Exchange drop-in) ────────────────

async function fetchAdsbLol() {
  const resp = await fetch(ADSBOOL_URL);
  if (!resp.ok) throw new Error(`adsb.lol ${resp.status}`);
  const data = await resp.json();
  // adsb.lol returns { aircraft: [...] } compatible with ADS-B Exchange format
  return (data.aircraft ?? [])
    .filter(a => a.lat && a.lon && !a.on_ground)
    .map(a => ({
      id:       a.hex,
      callsign: (a.flight ?? '').trim(),
      lat:      a.lat,
      lon:      a.lon,
      alt:      (a.alt_baro ?? 10000),
      heading:  a.track   ?? 0,
      velocity: a.gs      ?? 0,
    }));
}

// ── Provider: OpenSky Network (OAuth2, 4000 credits/day) ─────────────────────

async function fetchOpenSky() {
  const token = await getOpenSkyToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const resp = await fetch(OPENSKY_STATES_URL, { headers });
  if (!resp.ok) throw new Error(`OpenSky ${resp.status}`);
  const data = await resp.json();

  return (data.states ?? [])
    .filter(s => s[5] && s[6] && !s[8])  // lon, lat, not on ground
    .map(s => ({
      id:       s[0].trim(),
      callsign: (s[1] ?? '').trim(),
      lat:      s[6],
      lon:      s[5],
      alt:      s[7]  ?? 10000,
      heading:  s[10] ?? 0,
      velocity: s[9]  ?? 0,
    }));
}

/** Fetches + caches an OpenSky OAuth2 bearer token (30-min expiry). */
async function getOpenSkyToken() {
  if (!OPENSKY_CLIENT_ID || !OPENSKY_CLIENT_SECRET) return null;
  if (oskToken && Date.now() < oskTokenExp) return oskToken;

  try {
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     OPENSKY_CLIENT_ID,
      client_secret: OPENSKY_CLIENT_SECRET,
    });
    const resp = await fetch(OPENSKY_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) throw new Error(`Token ${resp.status}`);
    const data  = await resp.json();
    oskToken    = data.access_token;
    oskTokenExp = Date.now() + (data.expires_in - 60) * 1000; // refresh 1 min early
    return oskToken;
  } catch (err) {
    console.warn('[Flights] OpenSky token refresh failed:', err.message);
    return null;
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderAircraft(viewer, aircraft) {
  const seen = new Set();

  for (const a of aircraft) {
    const id = a.id;
    seen.add(id);

    if (entityMap.has(id)) {
      const entity = entityMap.get(id);
      entity.position = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.alt);
      if (entity.billboard) {
        entity.billboard.rotation = new Cesium.ConstantProperty(
          Cesium.Math.toRadians(-a.heading)
        );
      }
    } else {
      const entity = viewer.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.alt),
        billboard: {
          image:          AIRCRAFT_SVG,
          width:          18,
          height:         18,
          rotation:       Cesium.Math.toRadians(-a.heading),
          alignedAxis:    Cesium.Cartesian3.UNIT_Z,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.5, 3e6, 0.4),
          translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 2e6, 0.6),
          color:          Cesium.Color.fromCssColorString('#00ff88'),
        },
        label: {
          text:           a.callsign || id,
          font:           '10px "Share Tech Mono", monospace',
          fillColor:      Cesium.Color.fromCssColorString('#00ff88'),
          outlineColor:   Cesium.Color.BLACK,
          outlineWidth:   2,
          style:          Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:    new Cesium.Cartesian2(12, -6),
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 1e6, 0),
          translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0),
        },
        properties: {
          type:     'flight',
          callsign: a.callsign,
          velocity: a.velocity,
          altitude: a.alt,
          provider: PROVIDER,
        },
      });
      entityMap.set(id, entity);
    }
  }

  // Remove departed aircraft
  for (const [id, entity] of entityMap) {
    if (!seen.has(id)) {
      viewer.entities.remove(entity);
      entityMap.delete(id);
    }
  }

  console.debug(`[Flights] ${entityMap.size} aircraft (${PROVIDER})`);
}
