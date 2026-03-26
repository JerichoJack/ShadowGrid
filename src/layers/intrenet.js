/**
 * File: src/layers/intrenet.js
 * Purpose: Internet outage/blackout overlay rendering backed by server-fed IODA data.
 * Last updated: 2026-03-13
 */

import * as Cesium from 'cesium';

const INTERNET_URL = '/api/localproxy/api/internet';
const POLL_MS = 5 * 60_000;
const DEFAULT_MAX_HEIGHT_M = 18_000;
const HIGH_BLACKOUT_SCORE = 15_000_000;
const INTERNET_AGE_RULES = { fadeMs: 2 * 60 * 60 * 1000, expireMs: 24 * 60 * 60 * 1000 };

let internetDataSource = null;
let internetEnabled = false;
let pollTimer = null;
let latestPayload = null;

function flattenPoints(points) {
  const out = [];
  for (const [lon, lat] of points) out.push(lon, lat);
  return out;
}

function flattenClosedPoints(points) {
  if (!points.length) return [];
  return flattenPoints([...points, points[0]]);
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  const filtered = points
    .map(([lon, lat]) => [Number(lon), Number(lat)])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (filtered.length > 1) {
    const [firstLon, firstLat] = filtered[0];
    const [lastLon, lastLat] = filtered[filtered.length - 1];
    if (firstLon === lastLon && firstLat === lastLat) filtered.pop();
  }
  return filtered;
}

function parseTime(value) {
  const ts = Date.parse(value ?? '');
  return Number.isFinite(ts) ? ts : null;
}

function computeOpacity(zone, nowMs) {
  const startsAt = parseTime(zone.startsAt);
  const endsAt = parseTime(zone.endsAt);
  const observedAt = parseTime(zone.updatedAt) ?? parseTime(zone.observedAt) ?? startsAt;

  if (startsAt && startsAt > nowMs) return 0;
  if (endsAt && nowMs <= endsAt) return 1;
  if (!observedAt) return 1;

  const ageMs = Math.max(0, nowMs - observedAt);
  if (ageMs <= INTERNET_AGE_RULES.fadeMs) return 1;
  if (ageMs >= INTERNET_AGE_RULES.expireMs) return 0;
  return 1 - ((ageMs - INTERNET_AGE_RULES.fadeMs) / (INTERNET_AGE_RULES.expireMs - INTERNET_AGE_RULES.fadeMs));
}

function buildWindowLabel(zone) {
  const startsAt = zone.startsAt ? new Date(zone.startsAt).toISOString() : null;
  const endsAt = zone.endsAt ? new Date(zone.endsAt).toISOString() : null;
  const updatedAt = zone.updatedAt ? new Date(zone.updatedAt).toISOString() : null;
  if (startsAt && endsAt) return `${startsAt} to ${endsAt}`;
  if (updatedAt) return `Updated ${updatedAt}`;
  return 'Unknown window';
}

function reserveUniqueId(baseId, usedIds) {
  const seed = String(baseId ?? 'internet');
  const base = `zone-${seed}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let counter = 2;
  while (usedIds.has(`${base}-${counter}`)) counter += 1;
  const unique = `${base}-${counter}`;
  usedIds.add(unique);
  return unique;
}

function getBlackoutPalette(zone) {
  const score = Number(zone?.outageScore);
  const isHigh = Number.isFinite(score)
    ? score >= HIGH_BLACKOUT_SCORE
    : String(zone?.severity ?? '').toLowerCase() === 'high';

  return {
    fill: isHigh ? '#4c0de0' : '#ffcc3d',
    outline: '#000000',
  };
}

function syncVisibility() {
  if (internetDataSource) internetDataSource.show = internetEnabled;
}

function addInternetBlackout(zone, nowMs, maxHeight, usedIds) {
  const points = normalizePoints(zone.points);
  const opacity = computeOpacity(zone, nowMs);
  if (points.length < 3 || opacity <= 0 || !internetDataSource) return;

  const palette = getBlackoutPalette(zone);
  const fill = Cesium.Color.fromCssColorString(palette.fill).withAlpha(0.3 * opacity);
  const outline = Cesium.Color.fromCssColorString(palette.outline).withAlpha(0.95 * opacity);

  internetDataSource.entities.add({
    id: reserveUniqueId(zone.id, usedIds),
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(flattenPoints(points)),
        height: 0,
      extrudedHeight: Number(zone.ceilingMeters ?? maxHeight),
      material: fill,
      outline: false,
    },
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flattenClosedPoints(points)),
      width: 2,
      clampToGround: true,
      material: outline,
    },
    properties: {
      type: 'zone',
      domain: 'internet',
      id: zone.id,
      name: zone.name,
      outageType: zone.outageType ?? 'blackout',
      severity: zone.severity ?? 'medium',
      source: zone.source ?? 'IODA',
      status: zone.status ?? 'recent',
      activeWindowUtc: buildWindowLabel(zone),
      summary: zone.summary ?? '',
      asnScope: zone.asnScope ?? null,
      outageScore: Number(zone.outageScore ?? 0),
    },
  });
}

function renderPayload(payload) {
  latestPayload = payload;
  if (!internetDataSource) return;

  const nowMs = Date.now();
  const maxHeight = Number(payload?.maxFlightHeightMeters ?? DEFAULT_MAX_HEIGHT_M);
  const usedIds = new Set();

  internetDataSource.entities.removeAll();
  for (const zone of payload?.internetBlackouts ?? []) {
    addInternetBlackout(zone, nowMs, maxHeight, usedIds);
  }

  syncVisibility();
}

async function refreshInternet() {
  try {
    const response = await fetch(INTERNET_URL);
    if (!response.ok) throw new Error(`internet ${response.status}`);
    const payload = await response.json();
    renderPayload(payload);
  } catch (error) {
    console.warn('[internet] live refresh failed:', error);
    if (latestPayload) renderPayload(latestPayload);
  }
}

export async function initInternet(viewer) {
  internetDataSource = new Cesium.CustomDataSource('internet-outages');
  await viewer.dataSources.add(internetDataSource);

  syncVisibility();
  await refreshInternet();

  if (pollTimer) {
    window.clearInterval(pollTimer);
  }
  pollTimer = window.setInterval(refreshInternet, POLL_MS);

  return {
    setEnabled(value) {
      internetEnabled = !!value;
      syncVisibility();
    },
    get count() {
      return internetDataSource?.show ? internetDataSource.entities.values.length : 0;
    },
    destroy() {
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  };
}
