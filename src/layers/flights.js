/**
 * layers/flights.js
 * Live aircraft rendering with a switchable flight data provider.
 *
 * Controlled by VITE_FLIGHT_PROVIDER in your .env:
 *
 *   adsbool       — adsb.lol (free, no key, no rate limit — DEFAULT)
 *   airplaneslive — airplanes.live (free, no key, 1 req/sec limit)
 *   opensky       — OpenSky Network (free, OAuth2 client credentials required)
 *
 * Neither adsb.lol nor airplanes.live have a global /all endpoint.
 * We query 8 hub cities at 250nm radius and deduplicate by ICAO hex.
 * adsb.lol: requests are fired in parallel (no rate limit).
 * airplanes.live: requests are staggered 1.1s apart (1 req/sec limit).
 *
 * All requests proxy through Vite dev server to avoid CORS.
 */

import * as Cesium from 'cesium';

// ── Config ────────────────────────────────────────────────────────────────────

const PROVIDER = (import.meta.env.VITE_FLIGHT_PROVIDER ?? 'adsbool').toLowerCase();
const POLL_MS  = 30_000; // 30s — gives time for 8 staggered requests to complete
const RADIUS   = 250;    // nautical miles — API maximum

const OPENSKY_CLIENT_ID     = import.meta.env.VITE_OPENSKY_CLIENT_ID     ?? '';
const OPENSKY_CLIENT_SECRET = import.meta.env.VITE_OPENSKY_CLIENT_SECRET ?? '';
const OPENSKY_TOKEN_URL     = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

// 8 hub points for near-global coverage at 250nm radius each
const HUB_POINTS = [
  [  40.7,  -74.0 ],  // New York
  [  51.5,   -0.1 ],  // London
  [  48.9,    2.3 ],  // Paris
  [  35.7,  139.7 ],  // Tokyo
  [ -33.9,  151.2 ],  // Sydney
  [  19.4,  -99.1 ],  // Mexico City
  [   1.35, 103.8 ],  // Singapore
  [  55.8,   37.6 ],  // Moscow
];

const AIRCRAFT_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2L8 10H3l4 3-1.5 7L12 16l6.5 4L17 13l4-3h-5z"/></svg>`;

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {Map<string, Cesium.Entity>} */
const entityMap = new Map();
let enabled     = true;
let oskToken    = null;
let oskTokenExp = 0;

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
    get count()    { return entityMap.size; },
    get provider() { return PROVIDER; },
  };
}

// ── Fetch dispatch ────────────────────────────────────────────────────────────

async function fetchAndRender(viewer) {
  try {
    const aircraft = await fetchAircraft();
    renderAircraft(viewer, aircraft);
  } catch (err) {
    console.warn(`[Flights] Fetch failed (${PROVIDER}):`, err.message);
  }
}

async function fetchAircraft() {
  switch (PROVIDER) {
    case 'opensky':       return fetchOpenSky();
    case 'airplaneslive': return fetchHubPoints('/api/airplaneslive', 'airplaneslive', true);
    case 'adsbool':
    default:              return fetchHubPoints('/api/adsbool',       'adsb.lol',      false);
  }
}

// ── Provider: hub-point fan-out (adsb.lol + airplanes.live) ──────────────────

async function fetchHubPoints(prefix, name, stagger) {
  const raw = [];

  if (stagger) {
    // airplanes.live: 1 req/sec — fire sequentially with 1.1s gap
    for (const [lat, lon] of HUB_POINTS) {
      try {
        const r = await fetch(`${prefix}/v2/point/${lat}/${lon}/${RADIUS}`);
        if (r.ok) {
          const d = await r.json();
          raw.push(...(d.aircraft ?? []));
        }
      } catch (_) { /* ignore individual hub failures */ }
      await new Promise(r => setTimeout(r, 1100));
    }
  } else {
    // adsb.lol: no rate limit — fire all in parallel
    const results = await Promise.allSettled(
      HUB_POINTS.map(([lat, lon]) =>
        fetch(`${prefix}/v2/point/${lat}/${lon}/${RADIUS}`)
          .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
          .then(d => {
            // One-time diagnostic: log the raw response shape from the first hub
            if (!window.__wv_flights_diag) {
              window.__wv_flights_diag = true;
              console.info('[Flights] RAW response sample:', JSON.stringify(d).slice(0, 500));
            }
            return d.aircraft ?? d.ac ?? d.planes ?? d.data ?? [];
          })
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') raw.push(...r.value);
    }
  }

  // Deduplicate by ICAO hex
  const seen = new Map();
  for (const a of raw) {
    const id = (a.hex ?? '').toLowerCase();
    if (id && !seen.has(id)) seen.set(id, a);
  }

  console.info(`[Flights] ${seen.size} unique / ${raw.length} raw (${name})`);

  return [...seen.values()]
    .filter(a => a.lat && a.lon && a.alt_baro !== 'ground' && (a.alt_baro ?? 0) > 0)
    .map(a => ({
      id:       (a.hex ?? '').toLowerCase(),
      callsign: (a.flight ?? a.r ?? '').trim(),
      lat:      a.lat,
      lon:      a.lon,
      alt:      a.alt_baro ?? a.alt_geom ?? 10000,
      heading:  a.track ?? a.true_heading ?? 0,
      velocity: a.gs ?? 0,
    }))
    .filter(a => a.id);
}

// ── Provider: OpenSky Network (OAuth2, true global feed) ─────────────────────

async function fetchOpenSky() {
  const token   = await getOpenSkyToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const resp    = await fetch('/api/opensky/api/states/all', { headers });
  if (!resp.ok) throw new Error(`OpenSky ${resp.status}`);
  const data = await resp.json();

  return (data.states ?? [])
    .filter(s => s[5] && s[6] && !s[8])
    .map(s => ({
      id:       s[0].trim(),
      callsign: (s[1] ?? '').trim(),
      lat:      s[6],
      lon:      s[5],
      alt:      (s[7] ?? 3048) * 3.281,  // metres → feet
      heading:  s[10] ?? 0,
      velocity: (s[9]  ?? 0) * 1.944,    // m/s → knots
    }));
}

async function getOpenSkyToken() {
  if (!OPENSKY_CLIENT_ID || !OPENSKY_CLIENT_SECRET) return null;
  if (oskToken && Date.now() < oskTokenExp) return oskToken;
  try {
    const resp = await fetch(OPENSKY_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     OPENSKY_CLIENT_ID,
        client_secret: OPENSKY_CLIENT_SECRET,
      }),
    });
    if (!resp.ok) throw new Error(`Token ${resp.status}`);
    const d     = await resp.json();
    oskToken    = d.access_token;
    oskTokenExp = Date.now() + (d.expires_in - 60) * 1000;
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
    if (!a.id) continue;
    seen.add(a.id);

    const altMetres = a.alt * 0.3048; // feet → metres for Cesium

    if (entityMap.has(a.id)) {
      const entity = entityMap.get(a.id);
      entity.position = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, altMetres);
      if (entity.billboard) {
        entity.billboard.rotation = new Cesium.ConstantProperty(
          Cesium.Math.toRadians(-a.heading)
        );
      }
    } else {
      const entity = viewer.entities.add({
        id: `flight-${a.id}`,
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, altMetres),
        billboard: {
          image:                  AIRCRAFT_SVG,
          width:                  20,
          height:                 20,
          rotation:               Cesium.Math.toRadians(-a.heading),
          alignedAxis:            Cesium.Cartesian3.UNIT_Z,
          scaleByDistance:        new Cesium.NearFarScalar(1e3, 2.0, 8e6, 0.6),
          translucencyByDistance: new Cesium.NearFarScalar(1e3, 1.0, 1e7, 0.8),
          color:                  Cesium.Color.fromCssColorString('#00ff88'),
          // Must be false — depthTestAgainstTerrain in scene clips billboards
          // that are above terrain but whose screen position fails the depth test
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text:          a.callsign || a.id.toUpperCase(),
          font:          '10px "Share Tech Mono", monospace',
          fillColor:     Cesium.Color.fromCssColorString('#00ff88'),
          outlineColor:  Cesium.Color.BLACK,
          outlineWidth:  2,
          style:         Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:   new Cesium.Cartesian2(14, -8),
          scaleByDistance:        new Cesium.NearFarScalar(1e3, 1.0, 3e6, 0),
          translucencyByDistance: new Cesium.NearFarScalar(1e3, 1.0, 2e6, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          type:     'flight',
          callsign: a.callsign,
          velocity: a.velocity,
          altitude: a.alt,
          provider: PROVIDER,
        },
      });
      entityMap.set(a.id, entity);
    }
  }

  // Remove departed aircraft
  for (const [id, entity] of entityMap) {
    if (!seen.has(id)) {
      viewer.entities.remove(entity);
      entityMap.delete(id);
    }
  }

  console.info(`[Flights] Rendering ${entityMap.size} aircraft`);
}
