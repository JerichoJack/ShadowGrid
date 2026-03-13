/**
 * File: src/ui/Controls.js
 * Purpose: Wires layer controls, filter toggles, and display mode interactions.
 * Last updated: 2026-03-13
 */

let currentMode = 'normal';
const SERVER_HEAVY_MODE = ((import.meta.env.VITE_SERVER_HEAVY_MODE ?? 'false').toLowerCase() === 'true');

// Track collapsed state for filter containers
const filterCollapsedState = new Map();

function setSatelliteFilterButtonsActive(active) {
  const satFilterButtons = document.querySelectorAll('.filter-btn[data-filter^="satellites:"]');
  satFilterButtons.forEach((filterBtn) => {
    filterBtn.classList.toggle('active', active);
    filterBtn.classList.toggle('inactive', !active);
  });
}

export function initControls(viewer, layers) {
  if (SERVER_HEAVY_MODE) {
    setSatelliteFilterButtonsActive(false);
  }

  // ── Layer toggles ────────────────────────────────────────────────────────
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Check if click was on the collapse chevron
      const chevron = btn.querySelector('.collapse-chevron');
      if (e.target === chevron) {
        e.stopPropagation();
        const layerName = btn.dataset.layer;
        const filterContainer = btn.nextElementSibling;
        if (filterContainer?.classList.contains('filter-container')) {
          const isCollapsed = filterContainer.classList.toggle('collapsed');
          filterCollapsedState.set(layerName, isCollapsed);
        }
        return;
      }

      const layerName = btn.dataset.layer;
      const isActive = btn.classList.toggle('active');
      btn.classList.toggle('inactive', !isActive);

      const layer = layers[layerName];
      if (layer?.setEnabled) layer.setEnabled(isActive);

      window.dispatchEvent(new CustomEvent('shadowgrid:layer-toggle', {
        detail: { layer: layerName, active: isActive },
      }));

      if (SERVER_HEAVY_MODE && layerName === 'satellites' && isActive) {
        // In heavy mode start with no categories enabled so operators opt-in.
        setSatelliteFilterButtonsActive(false);
        const satFilterButtons = document.querySelectorAll('.filter-btn[data-filter^="satellites:"]');
        satFilterButtons.forEach((filterBtn) => {
          const [, filterType] = (filterBtn.dataset.filter ?? '').split(':');
          if (filterType) {
            layer?.setClassificationFilter?.(filterType, false);
          }
        });
      }

      // Show/hide filter container for this layer
      const filterContainer = btn.nextElementSibling;
      if (filterContainer?.classList.contains('filter-container')) {
        filterContainer.classList.toggle('visible', isActive);
        btn.classList.toggle('has-filters', isActive);
        // Keep the collapsed state if it was set previously
        if (!filterCollapsedState.has(layerName)) {
          filterCollapsedState.set(layerName, true); // Start collapsed by default
          filterContainer.classList.add('collapsed');
        }
      }
    });
  });

  // ── Classification/type filters ──────────────────────────────────────────
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const filterSpec = btn.dataset.filter; // e.g., "satellites:military" or "flights-classification:military"
      let layerName, filterType, filterCategory;
      
      // Handle new format: "flights-classification:military" or "satellites:military"
      if (filterSpec.includes('-')) {
        const parts = filterSpec.split(':');
        const prefix = parts[0]; // e.g., "flights-classification"
        filterType = parts[1]; // e.g., "military"
        
        if (prefix === 'flights-classification') {
          layerName = 'flights';
          filterCategory = 'classification';
        } else if (prefix === 'flights-type') {
          layerName = 'flights';
          filterCategory = 'type';
        }
      } else {
        // Old satellite format: "satellites:military"
        const parts = filterSpec.split(':');
        layerName = parts[0];
        filterType = parts[1];
      }
      
      const isActive = btn.classList.toggle('active');
      btn.classList.toggle('inactive', !isActive);

      const layer = layers[layerName];
      if (layerName === 'flights' && filterCategory === 'classification') {
        layer?.setAircraftClassificationFilter?.(filterType, isActive);
      } else if (layerName === 'flights' && filterCategory === 'type') {
        layer?.setAircraftTypeFilter?.(filterType, isActive);
      } else {
        // Satellites classification filter
        layer?.setClassificationFilter?.(filterType, isActive);
      }
    });
  });

  // ── Shader modes ─────────────────────────────────────────────────────────
  document.querySelectorAll('.shader-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;

      // Update button states
      document.querySelectorAll('.shader-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Apply visual mode
      applyShaderMode(viewer, mode);
      currentMode = mode;
    });
  });
}

function applyShaderMode(viewer, mode) {
  const body  = document.body;
  const scene = viewer.scene;
  const managedStages = new Set(['nvg', 'flir', 'crt']);

  // Remove all mode classes
  body.classList.remove('mode-nvg', 'mode-flir', 'mode-crt');

  // Clear any existing post-process stages we added.
  for (let i = scene.postProcessStages.length - 1; i >= 0; i -= 1) {
    const stage = scene.postProcessStages.get(i);
    if (managedStages.has(stage?.name)) {
      scene.postProcessStages.remove(stage);
    }
  }

  // Backward compatibility cleanup for the last applied stage pointer.
  if (scene._shadowgridStage) {
    scene.postProcessStages.remove(scene._shadowgridStage);
    scene._shadowgridStage = null;
  }

  switch (mode) {
    case 'normal':
      // Nothing — plain photorealistic, return to default Cesium rendering if coming from another mode
      break;

    case 'nvg':
      body.classList.add('mode-nvg');
      break;

    case 'flir':
      body.classList.add('mode-flir');
      break;

    case 'crt':
      body.classList.add('mode-crt');
      break;
  }
}
