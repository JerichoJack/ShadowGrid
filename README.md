# WorldView

WorldView is a browser-based geospatial viewer built with CesiumJS. It combines a 3D globe, live aircraft, satellite tracking, and post-process visual modes in a single Vite app.

## Current Implementation Status

Implemented now:

- 3D globe with switchable map providers: `cesium`, `google`, `maptiler`
- Live flights layer (poll every 10s)
- Aircraft icon system with silhouette-based shapes and class coloring
- Flight follow mode (switches selected aircraft to a lightweight 3D model)
- Satellite layer using TLE + SGP4 propagation via `satellite.js`
- Satellite provider selection: `celestrak`, `spacetrack`, `n2yo` (with fallback behavior)
- Shader modes: `normal`, `nvg`, `flir`, `crt`, `anime`
- HUD elements: UTC clock, entity counter, coordinate readout, click-to-inspect panel
- City/place search using Nominatim
- Startup camera geolocation via `ipapi.co` (fallback to env defaults)
- Local flight proxy server in `server/proxy.mjs`

Present in repo but not active in app flow:

- `src/layers/traffic.js` is a stub (Phase 5)
- `src/layers/cctv.js` is a stub (Phase 6)
- `src/archive/collector.js` exists for archive experiments (Phase 7), but is not wired into UI/runtime

## Tech Stack

- Frontend: Vite + vanilla ES modules
- Globe/rendering: CesiumJS
- Orbit propagation: `satellite.js`
- Local proxy: Node.js HTTP server (`server/proxy.mjs`)

## Provider Support (As Implemented)

### Map providers

Set in `.env` with `VITE_MAP_PROVIDER`:

- `cesium` (default)
- `google`
- `maptiler`

### Flight providers

Set in `.env` with `VITE_FLIGHT_PROVIDER`:

- `proxy` (default in code): uses local server at `http://localhost:3001/api/flights`
- `opensky`: uses OpenSky states endpoint, optional OAuth2 client credentials

The flights layer now supports all flight providers listed in `.env.example`: `airplaneslive`, `adsbool`, and `opensky` (plus local `proxy`).

### Satellite providers

Set in `.env` with `VITE_SATELLITE_PROVIDER`:

- `celestrak` (default)
- `spacetrack` (requires username/password env vars)
- `n2yo` (requires API key)

## Environment Variables

Use `.env.example` as the base template:

```bash
cp .env.example .env
```

Minimum practical setup:

```env
VITE_MAP_PROVIDER=cesium
VITE_CESIUM_ION_TOKEN=your_token_here

VITE_FLIGHT_PROVIDER=proxy

VITE_SATELLITE_PROVIDER=celestrak
```

Optional flight auth (only if using OpenSky):

```env
VITE_FLIGHT_PROVIDER=opensky
VITE_OPENSKY_CLIENT_ID=...
VITE_OPENSKY_CLIENT_SECRET=...
```

## Getting Started

Prerequisites:

- Node.js 18+

Install:

```bash
npm install
```

Run app + local flight proxy together:

```bash
npm start
```

Open:

- <http://localhost:5173>

## Run Modes

### All-in-one (recommended)

```bash
npm start
```

Starts:

- Vite dev server
- flight proxy (`server/proxy.mjs`)

### Frontend only

```bash
npm run dev
```

If `VITE_FLIGHT_PROVIDER=proxy`, you must also run in another terminal:

```bash
npm run proxy
```

## Local Flight Proxy

`server/proxy.mjs` provides viewport-aware aggregation from `opendata.adsb.fi`.

Behavior:

- accepts `bounds=minLon,minLat,maxLon,maxLat`
- selects overlapping 250nm hubs
- caches per hub (12s TTL)
- keeps an in-memory aircraft DB and prunes stale entries
- returns viewport-filtered aircraft list

Health check:

- `http://localhost:3001/health`

## Project Structure

```text
WorldView/
|-- server/
|   `-- proxy.mjs
|-- src/
|   |-- main.js
|   |-- archive/
|   |   `-- collector.js
|   |-- core/
|   |   |-- globe.js
|   |   |-- camera.js
|   |   `-- follow.js
|   |-- layers/
|   |   |-- flights.js
|   |   |-- satellites.js
|   |   |-- traffic.js    (stub)
|   |   `-- cctv.js       (stub)
|   `-- ui/
|       |-- Controls.js
|       |-- HUD.js
|       |-- citySearch.js
|       `-- clock.js
|-- index.html
|-- vite.config.js
`-- README.md
```

## Roadmap Alignment

- Phase 1: complete (globe + provider switching + live layers baseline)
- Phase 2: complete (aircraft silhouettes + classification colors)
- Phase 3: complete (satellite propagation + labels + tracks)
- Phase 4: incomplete (NVG/FLIR/CRT/Anime shader modes)
- Phase 5: not implemented (traffic stub)
- Phase 6: not implemented (CCTV stub)
- Phase 7: partial scaffolding only (`archive/collector.js`), no replay UI

## License

MIT. See `LICENSE`.
