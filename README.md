# 🌍 WorldView

A browser-based geospatial intelligence platform that lets you look at any place on Earth through the lens of a surveillance analyst — night vision, FLIR thermal, CRT scan lines, live air traffic, real satellite orbits, and actual CCTV camera feeds draped directly onto photorealistic 3D city models.

All of it running in a browser tab. No classified clearances required.

---

## ✨ Features

- **Photorealistic 3D Globe** — powered by your choice of Google 3D Tiles, Cesium ion, or MapTiler (switchable via a single env variable)
- **Live Air Traffic** — 7,000+ aircraft positions from OpenSky Network and ADS-B Exchange (including military flight tracking), updated in real time
- **Satellite Orbital Tracking** — 180+ satellites rendered on their actual orbital paths using CelesTrak TLE data; click any satellite to follow it
- **Street-Level Traffic** — vehicle flow on city streets from OpenStreetMap, rendered as a particle system
- **CCTV Integration** — real public traffic camera feeds geographically placed and projected as textures onto 3D buildings
- **Visual Shader Modes** — toggle between NVG (night vision), FLIR thermal, CRT scan lines, and anime cel-shading, each built from studying real military display specifications
- **4D Timeline / Replay** — scrub through archived snapshots of all data layers to reconstruct how a scene looked at any point in time
- **"God Mode"** — detection overlays combining all layers: every vehicle highlighted, military flights with callsigns, satellites in orbit, and CCTV feeds in one unified view

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| 3D Globe & Rendering | [CesiumJS](https://cesium.com/platform/cesiumjs/) |
| Photorealistic City Models | Google / Cesium ion / MapTiler *(switchable — see below)* |
| Visual Shaders | WebGL `PostProcessStage` (inline GLSL) |
| Live Flight Data | [OpenSky Network](https://opensky-network.org/) + [ADS-B Exchange](https://www.adsbexchange.com/) |
| Satellite Orbital Math | [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4 propagation) |
| Satellite TLE Data | [CelesTrak](https://celestrak.org/) |
| Street / Road Data | [OpenStreetMap](https://www.openstreetmap.org/) + Overpass API |
| CCTV Feeds | Public city traffic cam endpoints (MJPEG streams → VideoTexture) |
| Data Archival / Replay | Node.js cron jobs + SQLite / Postgres |
| Hosting | Vercel / Cloudflare Pages + lightweight VPS for data proxy |

---

## 🗺️ Map Provider Comparison

WorldView supports three map backends, switchable with a single line in your `.env`. No code changes required.

| Provider | Visual Quality | Cost | Credit Card Required | Best For |
|---|---|---|---|---|
| **Google 3D Tiles** | ⭐⭐⭐ Photogrammetric | Free tier ($200/mo credit) | ✅ Yes (billing account) | Production / best experience |
| **Cesium ion** | ⭐⭐ Terrain + OSM buildings | 100% free | ❌ No | Development / zero cost |
| **MapTiler** | ⭐⭐ Terrain + satellite | 100% free tier | ❌ No | Dev / mid-quality satellite |

Set your choice in `.env`:

```env
VITE_MAP_PROVIDER=cesium      # or: google | maptiler
```

---

## 🔑 API Keys Setup

### 1. Google Maps Platform *(only needed for `VITE_MAP_PROVIDER=google`)*

1. Go to the [Google Cloud Console](https://console.cloud.google.com) and create or select a project
2. Enable the **Map Tiles API**: [direct link](https://console.cloud.google.com/apis/library/tile.googleapis.com)
3. Go to **Credentials → Create API Key** and copy it
4. *(Recommended)* Click the key → **Restrict key** → limit to "Map Tiles API" and your domain
5. Enable billing on your project — you won't be charged unless you exceed $200/mo of usage, which is unlikely during development

### 2. Cesium ion *(recommended for everyone — free, no credit card)*

1. Create a free account at [ion.cesium.com](https://ion.cesium.com)
2. Navigate to **Access Tokens → Create token** (default scopes are fine)
3. Copy the token into `VITE_CESIUM_ION_TOKEN`

> Even if you're using Google or MapTiler as your map provider, setting a Cesium ion token suppresses console warnings about unauthenticated ion requests from the CesiumJS library itself.

### 3. MapTiler *(only needed for `VITE_MAP_PROVIDER=maptiler`)*

1. Create a free account at [cloud.maptiler.com](https://cloud.maptiler.com)
2. Navigate to **Account → API Keys** and copy your default key
3. The free tier includes global terrain + satellite imagery with no credit card required

### 4. OpenSky Network *(optional — improves flight data rate limits)*

1. Create a free account at [opensky-network.org](https://opensky-network.org)
2. Add your username and password to `VITE_OPENSKY_USERNAME` and `VITE_OPENSKY_PASSWORD`
3. Without credentials the API still works but is rate-limited to ~10 requests/10 minutes per IP

### 5. ADS-B Exchange *(optional — adds military & untracked flights)*

1. Visit [adsbexchange.com/data](https://www.adsbexchange.com/data/) and sign up for API access
2. Add your key to `VITE_ADSB_EXCHANGE_API_KEY`

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18+
- At minimum a **free Cesium ion token** (see API Keys above)

### Installation

```bash
git clone https://github.com/JerichoJack/WorldView.git
cd WorldView
npm install
```

### Environment Variables

```bash
cp .env.example .env
# Open .env and fill in your keys
```

The minimum viable setup (fully free, no credit card):

```env
VITE_MAP_PROVIDER=cesium
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token_here
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📁 Project Structure

```
WorldView/
├── src/
│   ├── core/
│   │   ├── globe.js              # CesiumJS viewer + provider switcher
│   │   └── camera.js             # Fly-to, orbit, and navigation controls
│   ├── layers/
│   │   ├── flights.js            # OpenSky + ADS-B live aircraft layer
│   │   ├── satellites.js         # CelesTrak TLE fetch + satellite.js propagation
│   │   ├── traffic.js            # OSM road network + particle system (Phase 5)
│   │   └── cctv.js               # Public cam feeds projected onto buildings (Phase 6)
│   ├── ui/
│   │   ├── HUD.js                # Targeting reticle + click-to-inspect panel
│   │   ├── Controls.js           # Layer toggles + shader mode buttons
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
- [ ] Phase 2 — Live flight layer (OpenSky + ADS-B)
- [ ] Phase 3 — Satellite orbital tracking (CelesTrak + satellite.js)
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

Shaders are applied as full-screen WebGL post-processing passes and can be toggled live without reloading any data layers.

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
- [OpenSky Network](https://opensky-network.org) — live flight data
- [CelesTrak](https://celestrak.org) — satellite TLE data
- [satellite.js](https://github.com/shashwatak/satellite-js) — SGP4 orbital propagation
