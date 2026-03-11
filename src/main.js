/**
 * WorldView — main entry point
 * Boots the globe, then lazily initialises each layer.
 */

import { initGlobe } from './core/globe.js';
import { initCamera } from './core/camera.js';
import { initFlights } from './layers/flights.js';
import { initSatellites } from './layers/satellites.js';
import { initControls } from './ui/Controls.js';
import { initHUD, updateHUDCounts } from './ui/HUD.js';
import { initCitySearch } from './ui/citySearch.js';
// startClock removed — HUD.js owns the UTC clock now

// ── Boot sequence ──────────────────────────────────────────────────────────

async function boot() {
  const steps = [
    { label: 'Initializing 3D Tiles…',       pct: 10 },
    { label: 'Loading photorealistic globe…', pct: 35 },
    { label: 'Connecting flight feeds…',      pct: 55 },
    { label: 'Propagating satellite orbits…', pct: 75 },
    { label: 'Mounting HUD…',                 pct: 90 },
    { label: 'System nominal.',               pct: 100 },
  ];

  const loadBar    = document.getElementById('load-bar');
  const loadStatus = document.getElementById('load-status');

  function setProgress(pct, label) {
    loadBar.style.width    = pct + '%';
    loadStatus.textContent = label;
  }

  // Step 1 – Globe
  setProgress(steps[0].pct, steps[0].label);
  const viewer = await initGlobe('cesium-container');

  // Step 2 – Camera
  setProgress(steps[1].pct, steps[1].label);
  await initCamera(viewer);

  // Step 3 – Flights
  setProgress(steps[2].pct, steps[2].label);
  const flights = await initFlights(viewer);
  flights?.setEnabled(false);  // Start with flights hidden

  // Step 4 – Satellites
  setProgress(steps[3].pct, steps[3].label);
  const satellites = await initSatellites(viewer);
  satellites?.setEnabled(false);  // Start with satellites hidden

  // Step 5 – UI
  setProgress(steps[4].pct, steps[4].label);
  initControls(viewer, { flights, satellites });
  initHUD(viewer);
  initCitySearch(viewer);

  // Step 6 – Done — hide loading screen
  setProgress(steps[5].pct, steps[5].label);
  await new Promise(r => setTimeout(r, 600));
  document.getElementById('loading').classList.add('hidden');

  // ── Live count feed → HUD status panel ──────────────────────────────────
  // Push aircraft + satellite + total-object counts every 5 s.
  setInterval(() => {
    const aircraftCount   = flights?.count   ?? 0;
    const satelliteCount  = satellites?.count ?? 0;
    const totalObjects    = viewer.entities.values.length;
    updateHUDCounts({
      aircraft:   aircraftCount,
      satellites: satelliteCount,
      objects:    totalObjects,
    });
  }, 5000);

  // Fire once immediately so it's not blank at startup
  updateHUDCounts({
    aircraft:   flights?.count   ?? 0,
    satellites: satellites?.count ?? 0,
    objects:    viewer.entities.values.length,
  });
}

boot().catch(err => {
  console.error('[WorldView] Boot failed:', err);
  document.getElementById('load-status').textContent = 'Error: ' + err.message;
  document.getElementById('load-bar').style.background = '#ff3333';
});