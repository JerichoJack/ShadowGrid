# 🌍 WorldView

A browser-based geospatial intelligence platform that lets you look at any place on Earth through the lens of a surveillance analyst — night vision, FLIR thermal, CRT scan lines, live air traffic, real satellite orbits, and actual CCTV camera feeds draped directly onto photorealistic 3D city models.

All of it running in a browser tab. No classified clearances required.

---

## ✨ Features

- **Photorealistic 3D Globe** — powered by Google's Photorealistic 3D Tiles, the same technology behind Google Earth's volumetric city models
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
| Photorealistic City Models | [Google Maps Photorealistic 3D Tiles API](https://developers.google.com/maps/documentation/tile) |
| Visual Shaders | WebGL `ShaderPass` / CesiumJS `PostProcessStage` |
| Live Flight Data | [OpenSky Network](https://opensky-network.org/) + [ADS-B Exchange](https://www.adsbexchange.com/) |
| Satellite Orbital Math | [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4 propagation) |
| Satellite TLE Data | [CelesTrak](https://celestrak.org/) |
| Street / Road Data | [OpenStreetMap](https://www.openstreetmap.org/) + Overpass API |
| CCTV Feeds | Public city traffic cam endpoints (MJPEG streams → VideoTexture) |
| Data Archival / Replay | Node.js cron jobs + SQLite / Postgres |
| Hosting | Vercel / Cloudflare Pages + lightweight VPS for data proxy |

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18+
- A [Google Maps Platform](https://developers.google.com/maps) API key (with 3D Tiles enabled)
- Optional: OpenSky Network account for higher rate limits

### Installation

```bash
git clone https://github.com/JerichoJack/WorldView.git
cd WorldView
npm install
```

### Environment Variables

Create a `.env` file in the root:

```env
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
VITE_OPENSKY_USERNAME=your_opensky_username      # optional
VITE_OPENSKY_PASSWORD=your_opensky_password      # optional
VITE_ADSB_EXCHANGE_API_KEY=your_adsb_key         # optional
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📁 Project Structure

```
worldview/
├── src/
│   ├── core/
│   │   ├── globe.js              # CesiumJS viewer + Google 3D Tiles setup
│   │   └── camera.js             # Fly-to, orbit, and navigation controls
│   ├── layers/
│   │   ├── flights.js            # OpenSky + ADS-B live aircraft layer
│   │   ├── satellites.js         # CelesTrak TLE fetch + satellite.js propagation
│   │   ├── traffic.js            # OSM road network + particle system
│   │   └── cctv.js               # Public cam feeds projected onto buildings
│   ├── shaders/
│   │   ├── nvg.glsl              # Night vision green-phosphor shader
│   │   ├── flir.glsl             # FLIR thermal false-color shader
│   │   ├── crt.glsl              # CRT scanline + barrel distortion shader
│   │   └── cel.glsl              # Anime cel-shading edge detection shader
│   ├── ui/
│   │   ├── HUD.js                # Targeting reticle + mode overlays
│   │   ├── Timeline.js           # 4D scrubber component
│   │   └── Controls.js           # Layer toggles + shader mode buttons
│   └── archive/
│       ├── collector.js          # Node.js cron: polls APIs, writes snapshots
│       └── replay.js             # Loads snapshots into the timeline
├── public/
│   └── models/                   # 3D aircraft/satellite GLTF models
├── server/
│   └── proxy.js                  # CORS proxy for CCTV streams + API calls
├── .env.example
├── package.json
└── README.md
```

---

## 🗺️ Build Roadmap

- [x] Phase 1 — CesiumJS globe with Google Photorealistic 3D Tiles
- [ ] Phase 2 — Live flight layer (OpenSky + ADS-B)
- [ ] Phase 3 — Satellite orbital tracking (CelesTrak + satellite.js)
- [ ] Phase 4 — Visual shaders (NVG, FLIR, CRT, Anime)
- [ ] Phase 5 — Street traffic particle system (OSM)
- [ ] Phase 6 — CCTV feed projection onto 3D buildings
- [ ] Phase 7 — 4D timeline + data archival / replay

---

## 🔑 API Keys & Services

All data sources used in WorldView are publicly available:

| Service | Cost | Notes |
|---|---|---|
| Google Maps (3D Tiles) | Free tier: $200/mo credit | Sufficient for development and moderate traffic |
| OpenSky Network | Free | Rate-limited; account gives higher limits |
| ADS-B Exchange | Free tier available | Best source for military flights |
| CelesTrak | Completely free | TLE data updated multiple times daily |
| OpenStreetMap / Overpass | Free | No key required |
| City CCTV feeds | Free | Sources vary by city open data portals |

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
- [OpenSky Network](https://opensky-network.org) — live flight data
- [CelesTrak](https://celestrak.org) — satellite TLE data
- [satellite.js](https://github.com/shashwatak/satellite-js) — SGP4 orbital propagation
