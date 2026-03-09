/**
 * core/globe.js
 * Initialises the CesiumJS viewer and mounts a 3D tile provider.
 *
 * Controlled by VITE_MAP_PROVIDER in your .env:
 *
 *   google    — Google Maps Photorealistic 3D Tiles (best visuals, needs billing enabled)
 *   cesium    — Cesium ion World Terrain + OSM Buildings (free, no credit card)
 *   maptiler  — MapTiler terrain + satellite imagery (free tier, no credit card)
 *
 * Docs:
 *   https://developers.google.com/maps/documentation/tile/3d-tiles
 *   https://cesium.com/platform/cesium-ion/
 *   https://docs.maptiler.com/cesium/
 */

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const PROVIDER        = (import.meta.env.VITE_MAP_PROVIDER         ?? 'cesium').toLowerCase();
const GOOGLE_KEY      =  import.meta.env.VITE_GOOGLE_MAPS_API_KEY  ?? '';
const CESIUM_TOKEN    =  import.meta.env.VITE_CESIUM_ION_TOKEN     ?? '';
const MAPTILER_KEY    =  import.meta.env.VITE_MAPTILER_API_KEY     ?? '';

const GOOGLE_TILESET_URL =
  `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_KEY}`;

const MAPTILER_TERRAIN_URL =
  `https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/tiles.json?key=${MAPTILER_KEY}`;

const MAPTILER_SATELLITE_URL =
  `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`;

// ── Entry point ──────────────────────────────────────────────────────────────

export async function initGlobe(containerId) {
  window.CESIUM_BASE_URL = '/cesium'; // served by vite-plugin-cesium

  // Set ion token if provided (needed even for non-ion providers to suppress warnings)
  if (CESIUM_TOKEN) Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

  const viewer = createViewer(containerId);

  switch (PROVIDER) {
    case 'google':    await mountGoogle(viewer);    break;
    case 'maptiler':  await mountMapTiler(viewer);  break;
    case 'cesium':
    default:          await mountCesiumIon(viewer); break;
  }

  window.__wv_viewer = viewer; // handy for console debugging
  return viewer;
}

// ── Shared viewer factory ────────────────────────────────────────────────────

function createViewer(containerId) {
  const viewer = new Cesium.Viewer(containerId, {
    animation:             false,
    baseLayerPicker:       false,
    fullscreenButton:      false,
    geocoder:              false,
    homeButton:            false,
    infoBox:               false,
    navigationHelpButton:  false,
    sceneModePicker:       false,
    selectionIndicator:    false,
    timeline:              false,
    vrButton:              false,
    imageryProvider:       false,   // each provider mounts its own
    scene3DOnly:           true,
    requestRenderMode:     false,   // continuous for live data layers
    shadows:               false,
  });

  const scene = viewer.scene;
  scene.backgroundColor                = Cesium.Color.BLACK;
  scene.fog.enabled                    = false;
  scene.globe.enableLighting           = false;
  scene.globe.depthTestAgainstTerrain  = true;
  scene.postProcessStages.fxaa.enabled = true;

  return viewer;
}

// ── Provider: Google Photorealistic 3D Tiles ─────────────────────────────────

async function mountGoogle(viewer) {
  if (!GOOGLE_KEY) {
    console.warn(
      '[WorldView] VITE_MAP_PROVIDER=google but VITE_GOOGLE_MAPS_API_KEY is not set.\n' +
      'Falling back to Cesium ion. Add your key to .env or switch provider.'
    );
    return mountCesiumIon(viewer);
  }

  try {
    // Google 3D Tiles replaces the globe surface entirely
    viewer.scene.globe.show = false;

    // Increase simultaneous tile requests for Google's CDN
    Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18;

    const tileset = await Cesium.Cesium3DTileset.fromUrl(GOOGLE_TILESET_URL, {
      showCreditsOnScreen:     true,
      maximumScreenSpaceError: 8,
    });

    viewer.scene.primitives.add(tileset);
    await viewer.zoomTo(tileset);

    console.info('[WorldView] Provider: Google Photorealistic 3D Tiles ✓');
  } catch (err) {
    console.error('[WorldView] Google 3D Tiles failed — falling back to Cesium ion:', err.message);
    viewer.scene.globe.show = true;
    await mountCesiumIon(viewer);
  }
}

// ── Provider: Cesium ion (free tier) ─────────────────────────────────────────

async function mountCesiumIon(viewer) {
  if (!CESIUM_TOKEN) {
    console.warn(
      '[WorldView] VITE_CESIUM_ION_TOKEN is not set.\n' +
      'Cesium ion features (terrain, OSM buildings) require a free token.\n' +
      'Get one at https://ion.cesium.com — falling back to ellipsoid terrain.'
    );
    return;
  }

  try {
    // World Terrain
    viewer.terrainProvider = await Cesium.createWorldTerrainAsync({
      requestWaterMask:     true,
      requestVertexNormals: true,
    });

    // Bing satellite imagery (included in Cesium ion free tier)
    viewer.imageryLayers.addImageryProvider(
      await Cesium.IonImageryProvider.fromAssetId(2)  // Bing Maps Aerial
    );

    // OSM Buildings (3D building footprints, worldwide)
    const osmBuildings = await Cesium.createOsmBuildingsAsync();
    viewer.scene.primitives.add(osmBuildings);

    console.info('[WorldView] Provider: Cesium ion (terrain + OSM buildings) ✓');
  } catch (err) {
    console.error('[WorldView] Cesium ion failed:', err.message);
    throw err;
  }
}

// ── Provider: MapTiler (free tier) ───────────────────────────────────────────

async function mountMapTiler(viewer) {
  if (!MAPTILER_KEY) {
    console.warn(
      '[WorldView] VITE_MAP_PROVIDER=maptiler but VITE_MAPTILER_API_KEY is not set.\n' +
      'Falling back to Cesium ion. Get a free key at https://cloud.maptiler.com'
    );
    return mountCesiumIon(viewer);
  }

  try {
    // MapTiler quantized-mesh terrain
    viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
      MAPTILER_TERRAIN_URL,
      { requestWaterMask: false, requestVertexNormals: true }
    );

    // MapTiler satellite imagery draped over terrain
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url:          MAPTILER_SATELLITE_URL,
        credit:       '© MapTiler © OpenStreetMap contributors',
        minimumLevel: 0,
        maximumLevel: 20,
        tileWidth:    256,
        tileHeight:   256,
      })
    );

    console.info('[WorldView] Provider: MapTiler (terrain + satellite) ✓');
  } catch (err) {
    console.error('[WorldView] MapTiler failed — falling back to Cesium ion:', err.message);
    await mountCesiumIon(viewer);
  }
}
