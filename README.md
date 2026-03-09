# 🌍 WorldView

A browser-based geospatial intelligence platform that lets you look at any place on Earth through the lens of a surveillance analyst — night vision, FLIR thermal, CRT scan lines, live air traffic, real satellite orbits, and actual CCTV camera feeds draped directly onto photorealistic 3D city models.

All of it running in a browser tab. No classified clearances required.

---

## ✨ Features

- **Photorealistic 3D Globe** — powered by your choice of Google 3D Tiles, Cesium ion, or MapTiler (switchable via a single env variable)
- **Live Air Traffic** — thousands of aircraft from your chosen flight data provider, updated every 15s
- **Satellite Orbital Tracking** — 180+ satellites rendered on actual orbital paths using real TLE data; click any to follow it
- **Street-Level Traffic** — vehicle flow on city streets from OpenStreetMap, rendered as a particle system *(Phase 5)*
- **CCTV Integration** — real public traffic camera feeds projected as textures onto 3D buildings *(Phase 6)*
- **Visual Shader Modes** — NVG (night vision), FLIR thermal, CRT scan lines, and anime cel-shading
- **4D Timeline / Replay** — scrub through archived snapshots of all data layers *(Phase 7)*
- **"God Mode"** — all layers combined: every vehicle highlighted, military flights, satellites, and CCTV in one unified view

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| 3D Globe & Rendering | [CesiumJS](https://cesium.com/platform/cesiumjs/) |
| Photorealistic City Models | Google / Cesium ion / MapTiler *(switchable)* |
| Visual Shaders | WebGL `PostProcessStage` (inline GLSL) |
| Live Flight Data | adsb.fi / adsb.lol / OpenSky Network *(switchable)* |
| Satellite Orbital Math | [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4 propagation) |
| Satellite TLE Data | CelesTrak / Space-Track / N2YO *(switchable)* |
| Street / Road Data | [OpenStreetMap](https://www.openstreetmap.org/) + Overpass API |
| CCTV Feeds | Public city traffic cam endpoints (MJPEG → VideoTexture) |
| Data Archival / Replay | Node.js cron jobs + SQLite / Postgres |
| Hosting | Vercel / Cloudflare Pages + lightweight VPS for data proxy |

---

## 🗺️ Map Provider Options

Set `VITE_MAP_PROVIDER` in your `.env` to switch instantly — no code changes.

| Provider | Visual Quality | Cost | Credit Card? | Notes |
|---|---|---|---|---|
| `google` | ⭐⭐⭐ Photogrammetric | Free tier ($200/mo credit) | ✅ Required | Best possible visuals |
| `cesium` | ⭐⭐ Terrain + OSM buildings | 100% free | ❌ No | Recommended default |
| `maptiler` | ⭐⭐ Terrain + satellite | 100% free tier | ❌ No | Good mid-ground option |

---

## ✈️ Flight Data Provider Options

Set `VITE_FLIGHT_PROVIDER` in your `.env` to switch.

| Provider | Coverage | Cost | Account / Key? | Notes |
|---|---|---|---|---|
| `adsbfi` | Global, ~20k+ aircraft | Free | ❌ None required | **Recommended default** |
| `adsbool` | Global, unfiltered | Free | ❌ None required | Includes military / untracked flights; ODbL licensed |
| `opensky` | Global, ~10k aircraft | Free (non-commercial) | ✅ OAuth2 client credentials | Migrated from username/password in March 2025 |

---

## 🛰️ Satellite TLE Provider Options

Set `VITE_SATELLITE_PROVIDER` in your `.env` to switch.

| Provider | Objects | Cost | Account / Key? | Notes |
|---|---|---|---|---|
| `celestrak` | 20,000+ | Free | ❌ None required | **Recommended default**; transitioning to OMM format ~July 2026 |
| `spacetrack` | Full catalog | Free | ✅ Free account (login) | Authoritative US Space Force data |
| `n2yo` | Targeted queries | Free tier (1k req/hr) | ✅ Free API key | Better for per-satellite lookups |

---

## 🔑 API Keys Setup

### 🌍 Map Providers

**Google Maps** *(only for `VITE_MAP_PROVIDER=google`)*
1. Go to [Google Cloud Console](https://console.cloud.google.com) and create/select a project
2. Enable the [Map Tiles API](https://console.cloud.google.com/apis/library/tile.googleapis.com)
3. Go to **Credentials → Create API Key**, then restrict it to "Map Tiles API"
4. Enable billing — the $200/mo free credit covers typical development usage

**Cesium ion** *(for `VITE_MAP_PROVIDER=cesium` — also recommended for all setups)*
1. Create a free account at [ion.cesium.com](https://ion.cesium.com)
2. **Access Tokens → Create token** (default scopes are fine)
3. Paste into `VITE_CESIUM_ION_TOKEN`

> Even if using Google or MapTiler, setting a Cesium ion token suppresses console warnings from the CesiumJS library itself.

**MapTiler** *(only for `VITE_MAP_PROVIDER=maptiler`)*
1. Create a free account at [cloud.maptiler.com](https://cloud.maptiler.com)
2. **Account → API Keys** → copy your default key
3. Paste into `VITE_MAPTILER_API_KEY`

---

### ✈️ Flight Data Providers

**adsb.fi** and **adsb.lol** — no setup required. Just set `VITE_FLIGHT_PROVIDER=adsbfi` or `adsbool` and go.

**OpenSky Network** *(for `VITE_FLIGHT_PROVIDER=opensky`)*

> ⚠️ OpenSky migrated to **OAuth2 in March 2025**. The old `username:password` method no longer works for new accounts. You now need API client credentials.

1. Create a free account at [opensky-network.org](https://opensky-network.org)
2. Go to your **Account page → "API Client" section**
3. Click **Create API Client** — a `credentials.json` file will download
4. Open it and copy `client_id` → `VITE_OPENSKY_CLIENT_ID`
5. Copy `client_secret` → `VITE_OPENSKY_CLIENT_SECRET`

Rate limits: 4,000 credits/day authenticated · anonymous access is heavily throttled.

---

### 🛰️ Satellite TLE Providers

**CelesTrak** — no setup required. Set `VITE_SATELLITE_PROVIDER=celestrak` and go.

**Space-Track** *(for `VITE_SATELLITE_PROVIDER=spacetrack`)*
1. Register for a free account at [space-track.org](https://www.space-track.org)
2. Add your login to `VITE_SPACETRACK_USERNAME` and `VITE_SPACETRACK_PASSWORD`

**N2YO** *(for `VITE_SATELLITE_PROVIDER=n2yo`)*
1. Request a free API key at [n2yo.com/api](https://www.n2yo.com/api/)
2. Paste into `VITE_N2YO_API_KEY`
3. Free tier: 1,000 requests/hour

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18+
- At minimum, a **free Cesium ion token** is recommended (no credit card)

### Installation

```bash
git clone https://github.com/JerichoJack/WorldView.git
cd WorldView
npm install
```

### Minimum viable setup (fully free, zero cost, no credit card)

```bash
cp .env.example .env
```

Then set these three lines in `.env`:

```env
VITE_MAP_PROVIDER=cesium
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token_here

VITE_FLIGHT_PROVIDER=adsbfi

VITE_SATELLITE_PROVIDER=celestrak
```

### Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 📁 Project Structure

```
WorldView/
├── src/
│   ├── core/
│   │   ├── globe.js              # CesiumJS viewer + map provider switcher
│   │   └── camera.js             # Fly-to, orbit, navigation + city presets
│   ├── layers/
│   │   ├── flights.js            # Flight provider switcher (adsb.fi / adsb.lol / OpenSky)
│   │   ├── satellites.js         # Satellite provider switcher (CelesTrak / Space-Track / N2YO)
│   │   ├── traffic.js            # OSM road network + particle system (Phase 5)
│   │   └── cctv.js               # CCTV feeds projected onto buildings (Phase 6)
│   ├── ui/
│   │   ├── HUD.js                # Targeting reticle + click-to-inspect panel
│   │   ├── Controls.js           # Layer toggles + shader mode buttons + GLSL shaders
│   │   └── clock.js              # UTC clock
│   └── archive/
│       └── collector.js          # Node.js cron: polls APIs, writes snapshots (Phase 7)
├── public/
│   ├── favicon.svg
│   └── models/                   # 3D aircraft/satellite GLTF models (future)
├── .env.example
├── package.json
├── vite.config.js
└── README.md
```

---

## 🗺️ Build Roadmap

- [x] Phase 1 — CesiumJS globe with switchable map provider (Google / Cesium ion / MapTiler)
- [x] Phase 1 — Switchable flight data providers (adsb.fi / adsb.lol / OpenSky)
- [x] Phase 1 — Switchable satellite TLE providers (CelesTrak / Space-Track / N2YO)
- [ ] Phase 2 — Live flight layer polish (ADS-B military callsigns, altitude filters)
- [ ] Phase 3 — Satellite orbital tracking polish (click-to-track, orbital period display)
- [ ] Phase 4 — Visual shaders (NVG, FLIR, CRT, Anime)
- [ ] Phase 5 — Street traffic particle system (OSM)
- [ ] Phase 6 — CCTV feed projection onto 3D buildings
- [ ] Phase 7 — 4D timeline + data archival / replay

---

## 🎨 Shader Modes

| Mode | Description |
|---|---|
| **Normal** | Default photorealistic view |
| **NVG** | Green-channel night vision with noise grain and vignette |
| **FLIR** | Thermal false-color (iron palette) simulating infrared sensors |
| **CRT** | Retro scanline overlay with barrel distortion and phosphor bloom |
| **Anime** | Cel-shading via Sobel edge detection + quantized color bands |

---

## 💡 Inspiration

This project is a direct replication and exploration of [Bilawal Sidhu's WorldView](https://www.spatialintelligence.ai/p/i-built-a-spy-satellite-simulator) — a "spy satellite simulator in a browser" that fuses open-source intelligence feeds onto a photorealistic 3D globe. Bilawal's original repo has not been made public; this is my attempt to reverse-engineer and build the same system from the ground up using the same publicly documented tools and data sources.

The core thesis: the data was never the moat. Surveillance-grade views of the world are built entirely from open, public feeds. WorldView makes that visible.

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

## 🙏 Credits

- [Bilawal Sidhu](https://www.spatialintelligence.ai) — original WorldView concept and thesis
- [CesiumJS](https://cesium.com) — open-source 3D geospatial engine
- [Google Maps Platform](https://developers.google.com/maps) — Photorealistic 3D Tiles
- [Cesium ion](https://ion.cesium.com) — hosted terrain and imagery
- [MapTiler](https://www.maptiler.com) — terrain and satellite tile services
- [adsb.fi](https://adsb.fi) — free community ADS-B flight data
- [adsb.lol](https://adsb.lol) — free open ADS-B flight data (ODbL)
- [OpenSky Network](https://opensky-network.org) — open flight data research network
- [CelesTrak](https://celestrak.org) — free satellite TLE data
- [Space-Track.org](https://space-track.org) — US Space Force satellite catalog
- [N2YO](https://n2yo.com) — satellite tracking API
- [satellite.js](https://github.com/shashwatak/satellite-js) — SGP4 orbital propagation
