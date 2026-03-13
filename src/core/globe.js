/**
 * File: src/core/globe.js
 * Purpose: Creates the Cesium viewer and wires the configured globe/tiles provider.
 * Providers: Cesium ion, Google Photorealistic 3D Tiles, or MapTiler.
 * Last updated: 2026-03-13
 */

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const PROVIDER     = (import.meta.env.VITE_MAP_PROVIDER        ?? 'cesium').toLowerCase();
const SERVER_HEAVY_MODE = (import.meta.env.VITE_SERVER_HEAVY_MODE ?? 'false').toLowerCase() === 'true';
const GOOGLE_KEY   =  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
const CESIUM_TOKEN =  import.meta.env.VITE_CESIUM_ION_TOKEN    ?? '';
const MAPTILER_KEY =  import.meta.env.VITE_MAPTILER_API_KEY    ?? '';

const GOOGLE_TILESET_URL = SERVER_HEAVY_MODE
  ? '/api/localproxy/tiles/google/v1/3dtiles/root.json'
  : `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_KEY}`;
const MAPTILER_TERRAIN_URL = SERVER_HEAVY_MODE
  ? '/api/localproxy/tiles/maptiler/tiles/terrain-quantized-mesh-v2/tiles.json'
  : `https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/tiles.json?key=${MAPTILER_KEY}`;
const MAPTILER_SATELLITE_URL = SERVER_HEAVY_MODE
  ? '/api/localproxy/tiles/maptiler/tiles/satellite-v2/{z}/{x}/{y}.jpg'
  : `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function initGlobe(containerId) {
  // Set ion token before anything else
  if (CESIUM_TOKEN) {
    Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;
  } else {
    console.warn('[ShadowGrid] No VITE_CESIUM_ION_TOKEN set. Get a free token at https://ion.cesium.com');
  }

  switch (PROVIDER) {
    case 'google':   return initGoogle(containerId);
    case 'maptiler': return initMapTiler(containerId);
    case 'cesium':
    default:         return initCesiumIon(containerId);
  }
}

// ── Shared base viewer options ────────────────────────────────────────────────

function baseOptions() {
  return {
    animation:            false,
    baseLayerPicker:      false,
    fullscreenButton:     false,
    geocoder:             false,
    homeButton:           false,
    infoBox:              false,
    navigationHelpButton: false,
    sceneModePicker:      false,
    selectionIndicator:   false,
    timeline:             false,
    vrButton:             false,
    scene3DOnly:          true,
    requestRenderMode:    false,
    shadows:              false,
    // Suppress default imagery — each provider sets its own
    imageryProvider:      false,
  };
}

function applySceneSettings(viewer) {
  const scene = viewer.scene;
  scene.backgroundColor                = Cesium.Color.BLACK;
  scene.fog.enabled                    = false;
  scene.globe.enableLighting           = false;
  scene.globe.depthTestAgainstTerrain  = true;
  scene.postProcessStages.fxaa.enabled = true;

  // ── Google Earth-style camera controls ───────────────────────────────────
  const ctrl = viewer.scene.screenSpaceCameraController;

  // Left-drag = pan (translate across the surface) — Google Earth default
  ctrl.tiltEventTypes = [
    Cesium.CameraEventType.RIGHT_DRAG,           // right-drag = tilt/orbit
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
  ];
  ctrl.rotateEventTypes = [
    Cesium.CameraEventType.LEFT_DRAG,
  ];
  ctrl.translateEventTypes = [
    Cesium.CameraEventType.MIDDLE_DRAG,
  ];
  ctrl.zoomEventTypes = [
    Cesium.CameraEventType.WHEEL,                // scroll = zoom
    Cesium.CameraEventType.PINCH,                // pinch = zoom
    { eventType: Cesium.CameraEventType.RIGHT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT },
  ];
  ctrl.lookEventTypes = [
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT },
  ];

  // Feel tuning — snappier zoom, smoother pan inertia
  ctrl.inertiaSpin          = 0.5;
  ctrl.inertiaTranslate     = 0.75;
  ctrl.inertiaZoom          = 0.2;
  ctrl.minimumZoomDistance  = 100;    // don't go below 100 m
  ctrl.maximumZoomDistance  = 2.0e7; // don't zoom out past ~20 000 km
  ctrl.enableCollisionDetection = true;
}


// ── Labels + borders overlay ──────────────────────────────────────────────────
// Adds a transparent country/city labels + borders layer on top of any base imagery.
// Uses Cesium ion asset 3812 (Cesium OSM Labels) — free, no extra key needed.

async function addLabelsOverlay(viewer) {
  try {
    // Use public Stamen Toner overlays via Stadia instead of ion asset 3812,
    // which now returns 404 in some accounts/regions.
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url:    'https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}.png',
        credit: '© Stadia Maps © Stamen Design © OpenStreetMap contributors',
        minimumLevel: 0,
        maximumLevel: 20,
      })
    );
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url:    'https://tiles.stadiamaps.com/tiles/stamen_toner_labels/{z}/{x}/{y}.png',
        credit: '© Stadia Maps © Stamen Design © OpenStreetMap contributors',
        minimumLevel: 0,
        maximumLevel: 20,
      })
    );
    console.info('[ShadowGrid] Labels + borders overlay added ✓');
  } catch (err) {
    console.warn('[ShadowGrid] Labels overlay unavailable:', err.message);
  }
}

// ── Provider: Cesium ion ──────────────────────────────────────────────────────

async function initCesiumIon(containerId) {
  console.info('[ShadowGrid] Provider: Cesium ion');

  // Resolve terrain BEFORE constructing Viewer — avoids the async-in-constructor hang
  let terrainProvider;
  try {
    terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
      requestWaterMask:     true,
      requestVertexNormals: true,
    });
  } catch (err) {
    console.warn('[ShadowGrid] World Terrain failed, using ellipsoid:', err.message);
    terrainProvider = new Cesium.EllipsoidTerrainProvider();
  }

  const viewer = new Cesium.Viewer(containerId, {
    ...baseOptions(),
    terrainProvider,
  });

  applySceneSettings(viewer);

  // Add Bing satellite imagery
  try {
    const bing = await Cesium.IonImageryProvider.fromAssetId(2);
    viewer.imageryLayers.addImageryProvider(bing);
  } catch (err) {
    console.warn('[ShadowGrid] Bing imagery unavailable:', err.message);
    // Fallback to OpenStreetMap so the globe isn't blank
    viewer.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
    );
  }

  // Labels + borders overlay (on top of satellite)
  await addLabelsOverlay(viewer);

  // OSM 3D Buildings
  try {
    const osm = await Cesium.createOsmBuildingsAsync();
    viewer.scene.primitives.add(osm);
  } catch (err) {
    console.warn('[ShadowGrid] OSM Buildings unavailable:', err.message);
  }

  window.__wv_viewer = viewer;
  console.info('[ShadowGrid] Cesium ion ready ✓');
  return viewer;
}

// ── Provider: Google Photorealistic 3D Tiles ──────────────────────────────────

async function initGoogle(containerId) {
  if (!GOOGLE_KEY) {
    console.warn('[ShadowGrid] No VITE_GOOGLE_MAPS_API_KEY — falling back to Cesium ion.');
    return initCesiumIon(containerId);
  }

  console.info('[ShadowGrid] Provider: Google Photorealistic 3D Tiles');

  const viewer = new Cesium.Viewer(containerId, {
    ...baseOptions(),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  });

  applySceneSettings(viewer);
  viewer.scene.globe.show = false; // 3D Tiles replace the globe surface

  try {
    Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18;
    const tileset = await Cesium.Cesium3DTileset.fromUrl(GOOGLE_TILESET_URL, {
      showCreditsOnScreen:     true,
      maximumScreenSpaceError: 8,
    });
    viewer.scene.primitives.add(tileset);
    await viewer.zoomTo(tileset);
    console.info('[ShadowGrid] Google 3D Tiles ready ✓');
  } catch (err) {
    console.error('[ShadowGrid] Google 3D Tiles failed — falling back to Cesium ion:', err.message);
    viewer.scene.globe.show = true;
    return initCesiumIon(containerId);
  }

  window.__wv_viewer = viewer;
  return viewer;
}

// ── Provider: MapTiler ────────────────────────────────────────────────────────

async function initMapTiler(containerId) {
  if (!MAPTILER_KEY) {
    console.warn('[ShadowGrid] No VITE_MAPTILER_API_KEY — falling back to Cesium ion.');
    return initCesiumIon(containerId);
  }

  console.info('[ShadowGrid] Provider: MapTiler');

  // Resolve terrain before Viewer construction
  let terrainProvider;
  try {
    terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(MAPTILER_TERRAIN_URL, {
      requestVertexNormals: true,
    });
  } catch (err) {
    console.warn('[ShadowGrid] MapTiler terrain failed — falling back to Cesium ion:', err.message);
    return initCesiumIon(containerId);
  }

  const viewer = new Cesium.Viewer(containerId, {
    ...baseOptions(),
    terrainProvider,
  });

  applySceneSettings(viewer);

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

  await addLabelsOverlay(viewer);

  window.__wv_viewer = viewer;
  console.info('[ShadowGrid] MapTiler ready ✓');
  return viewer;
}
