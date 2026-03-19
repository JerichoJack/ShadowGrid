// --- Aircraft database lookup (offline icao24 → typecode/model/category) ---
// Requires PapaParse: npm install papaparse OR include via CDN
// Example CDN: <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>

// Paths to all CSV files in the aircraft database folder
const AIRCRAFT_CSV_PATHS = [
  '/aircraft-database-files/aircraftDatabase.csv',
  '/aircraft-database-files/aircraftTypes.csv',
  '/aircraft-database-files/manufacturers.csv',
];

// Will hold icao24 (lowercase) → {typecode, manufacturer, model, category, ...}
const aircraftDb = {};
// Will hold typecode → type info (from aircraftTypes.csv)
const typeDb = {};
// Will hold manufacturer code → manufacturer name (from manufacturers.csv)
const manufacturerDb = {};


// Load and parse all CSVs at startup
function loadAircraftDatabase() {
  if (typeof Papa === 'undefined') {
    console.warn('PapaParse is required for aircraft database lookup.');
    return;
  }

  let loaded = 0;
  const total = AIRCRAFT_CSV_PATHS.length;

  // Parse aircraftDatabase.csv (by icao24)
  Papa.parse(AIRCRAFT_CSV_PATHS[0], {
    download: true,
    header: true,
    skipEmptyLines: true,
    step: function(row) {
      const r = row.data;
      const icao24 = (r.icao24 || r.ICAO24 || r.hex || '').toLowerCase();
      if (!icao24) return;
      aircraftDb[icao24] = {
        typecode: r.typecode || r.Typecode || r.type || '',
        manufacturer: r.manufacturer || r.Manufacturer || '',
        model: r.model || r.Model || '',
        category: r.category || r.Category || '',
        // Add more fields as needed
      };
    },
    complete: function() {
      loaded++;
      if (loaded === total) onAllCsvsLoaded();
    }
  });

  // Parse aircraftTypes.csv (by typecode)
  Papa.parse(AIRCRAFT_CSV_PATHS[1], {
    download: true,
    header: true,
    skipEmptyLines: true,
    step: function(row) {
      const r = row.data;
      const typecode = (r.Designator || r.typecode || r.Typecode || r.type || '').toUpperCase();
      if (!typecode) return;
      typeDb[typecode] = {
        description: r.Description || r.AircraftDescription || '',
        engineCount: r.EngineCount || '',
        engineType: r.EngineType || '',
        manufacturerCode: r.ManufacturerCode || '',
        modelFullName: r.ModelFullName || '',
        wtc: r.WTC || '',
      };
    },
    complete: function() {
      loaded++;
      if (loaded === total) onAllCsvsLoaded();
    }
  });

  // Parse manufacturers.csv (by code)
  Papa.parse(AIRCRAFT_CSV_PATHS[2], {
    download: true,
    header: true,
    skipEmptyLines: true,
    step: function(row) {
      const r = row.data;
      const code = (r.Code || '').toUpperCase();
      if (!code) return;
      manufacturerDb[code] = r.Name || '';
    },
    complete: function() {
      loaded++;
      if (loaded === total) onAllCsvsLoaded();
    }
  });
}

// Called when all CSVs are loaded
function onAllCsvsLoaded() {
  console.log('[AircraftDB] Loaded', Object.keys(aircraftDb).length, 'aircraft,', Object.keys(typeDb).length, 'types,', Object.keys(manufacturerDb).length, 'manufacturers');
}

// Call this at startup
loadAircraftDatabase();

// Helper to enrich an aircraft object with DB info if missing
function enrichAircraftFromDb(a) {
  const icao24 = (a.icao24 ?? a.hex ?? '').toLowerCase();
  if (!icao24) return;
  const db = aircraftDb[icao24];
  if (db) {
    if (!a.typecode && db.typecode) a.typecode = db.typecode;
    if (!a.manufacturer && db.manufacturer) a.manufacturer = db.manufacturer;
    if (!a.model && db.model) a.model = db.model;
    if (!a.category && db.category) a.category = db.category;
    // Add more fields as needed
  }

  // Enrich with type info if typecode is present
  const typecode = (a.typecode || '').toUpperCase();
  const typeInfo = typeDb[typecode];
  if (typeInfo) {
    if (!a.engineCount && typeInfo.engineCount) a.engineCount = typeInfo.engineCount;
    if (!a.engineType && typeInfo.engineType) a.engineType = typeInfo.engineType;
    if (!a.modelFullName && typeInfo.modelFullName) a.modelFullName = typeInfo.modelFullName;
    if (!a.wtc && typeInfo.wtc) a.wtc = typeInfo.wtc;
    if (!a.typeDescription && typeInfo.description) a.typeDescription = typeInfo.description;
    if (!a.manufacturer && typeInfo.manufacturerCode && manufacturerDb[typeInfo.manufacturerCode]) {
      a.manufacturer = manufacturerDb[typeInfo.manufacturerCode];
    }
  }

  // Enrich manufacturer name if manufacturer code is present
  if (a.manufacturer && manufacturerDb[a.manufacturer.toUpperCase()]) {
    a.manufacturerFull = manufacturerDb[a.manufacturer.toUpperCase()];
  }
}
/**
 * File: src/layers/flights.js
 * Purpose: Live aircraft rendering, selection enrichment, and server-heavy snapshot integration.
 * Notes: Supports multiple providers with proxy-backed auth/data routing.
 * Last updated: 2026-03-13
 */

import * as Cesium from 'cesium';
import { setServerSnapshotLayerEnabled, subscribeServerSnapshot } from '../core/serverSnapshot.js';

const PROVIDER = (import.meta.env.VITE_FLIGHT_PROVIDER ?? 'opensky').toLowerCase();
const SERVER_HEAVY_MODE = (import.meta.env.VITE_SERVER_HEAVY_MODE ?? 'false').toLowerCase() === 'true';
const ACTIVE_PROVIDER = SERVER_HEAVY_MODE ? 'proxy' : PROVIDER;
const POLL_MS  = 22_000;
const PROXY_URL = '/api/localproxy/api/flights';
const NOFLY_GPS_URL = '/api/localproxy/api/nofly_gps';
const NOFLY_GPS_POLL_MS = 5 * 60_000;
const NOFLY_GPS_DEFAULT_MAX_HEIGHT_M = 18_000;
const ADSBOOL_BASE_URL = '/api/adsbool';
const AIRPLANESLIVE_BASE_URL = '/api/airplaneslive';

const OPENSKY_CLIENT_ID     = import.meta.env.VITE_OPENSKY_CLIENT_ID     ?? '';
const OPENSKY_CLIENT_SECRET = import.meta.env.VITE_OPENSKY_CLIENT_SECRET ?? '';
// Must go through Vite proxy; auth.opensky-network.org blocks direct browser
//     fetches with no CORS headers. The /api/opensky-auth proxy rewrites the host.
const OPENSKY_TOKEN_URL = '/api/opensky-auth/auth/realms/opensky-network/protocol/openid-connect/token';

// ── Aircraft icon shapes — tar1090-style path-based silhouettes ──────────────
// Each entry: { w, h, viewBox, strokeScale, path, accent? }
// path / accent are SVG path 'd' strings (or arrays of strings).
// Rendering is handled by buildSvgUri / buildGlowSvgUri below.
//
// Sourced from tar1090/markers.js (MIT / open licence).

const SHAPES = {

  // HEAVY — wide double-deck fuselage, 4 engines under very wide swept wings
  // Represents: B747, B748, A380, A340, B777 (large widebody)
  heavy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="36" height="36">
    <g transform="translate(50,50)" fill="FILL" stroke="STROKE" stroke-width="1.2" stroke-linejoin="round">
      <!-- Fuselage — fat & long -->
      <ellipse cx="0" cy="-2" rx="5.5" ry="34" />
      <!-- Wide swept wings -->
      <path d="M-5,-8 L-44,18 L-42,24 L-5,10 Z"/>
      <path d="M5,-8 L44,18 L42,24 L5,10 Z"/>
      <!-- Inner engine pods under wings -->
      <ellipse cx="-22" cy="10" rx="4.5" ry="8" transform="rotate(-18,-22,10)"/>
      <ellipse cx="22" cy="10" rx="4.5" ry="8" transform="rotate(18,22,10)"/>
      <!-- Outer engine pods -->
      <ellipse cx="-34" cy="17" rx="3.5" ry="7" transform="rotate(-18,-34,17)"/>
      <ellipse cx="34" cy="17" rx="3.5" ry="7" transform="rotate(18,34,17)"/>
      <!-- Horizontal stabilisers -->
      <path d="M-4,28 L-22,38 L-21,42 L-4,34 Z"/>
      <path d="M4,28 L22,38 L21,42 L4,34 Z"/>
      <!-- Vertical tail (spine line) -->
      <line x1="0" y1="26" x2="0" y2="36" stroke-width="2.5"/>
    </g>
  </svg>`,

  // WIDEBODY — 2-engine widebody, moderately swept wings
  // Represents: B767, B787, A300, A330, A350
  widebody: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32">
    <g transform="translate(50,50)" fill="FILL" stroke="STROKE" stroke-width="1.2" stroke-linejoin="round">
      <!-- Fuselage — medium-fat -->
      <ellipse cx="0" cy="-2" rx="4.5" ry="32"/>
      <!-- Swept wings, wider chord -->
      <path d="M-4.5,-6 L-40,16 L-38,22 L-4.5,8 Z"/>
      <path d="M4.5,-6 L40,16 L38,22 L4.5,8 Z"/>
      <!-- Engine pods, 1 per wing -->
      <ellipse cx="-26" cy="10" rx="4" ry="8" transform="rotate(-16,-26,10)"/>
      <ellipse cx="26" cy="10" rx="4" ry="8" transform="rotate(16,26,10)"/>
      <!-- Horizontal stabs -->
      <path d="M-4,26 L-20,36 L-19,40 L-4,31 Z"/>
      <path d="M4,26 L20,36 L19,40 L4,31 Z"/>
      <line x1="0" y1="25" x2="0" y2="34" stroke-width="2.5"/>
    </g>
  </svg>`,

  // JET — narrow-body, 2 engines under moderately swept wings
  // Represents: B737, A320, B757, E190 etc. — the most common type
  jet: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="28" height="28">
    <g transform="translate(50,50)" fill="FILL" stroke="STROKE" stroke-width="1.2" stroke-linejoin="round">
      <!-- Fuselage — slim -->
      <ellipse cx="0" cy="-2" rx="3.5" ry="30"/>
      <!-- Wings — swept, medium span -->
      <path d="M-3.5,-4 L-32,14 L-30,20 L-3.5,7 Z"/>
      <path d="M3.5,-4 L32,14 L30,20 L3.5,7 Z"/>
      <!-- Engine pods under wings -->
      <ellipse cx="-20" cy="8" rx="3.2" ry="7" transform="rotate(-14,-20,8)"/>
      <ellipse cx="20" cy="8" rx="3.2" ry="7" transform="rotate(14,20,8)"/>
      <!-- Stabilisers -->
      <path d="M-3,24 L-16,32 L-15,36 L-3,29 Z"/>
      <path d="M3,24 L16,32 L15,36 L3,29 Z"/>
      <line x1="0" y1="23" x2="0" y2="31" stroke-width="2.5"/>
    </g>
  </svg>`,

  // TURBOPROP — short fuselage, straight high wings, prominent circular prop discs
  // Represents: ATR-42/72, Dash-8, King Air, Saab 340
  turboprop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="28" height="28">
    <g transform="translate(50,50)" fill="FILL" stroke="STROKE" stroke-width="1.2" stroke-linejoin="round">
      <!-- Fuselage — stubby -->
      <ellipse cx="0" cy="2" rx="4" ry="24"/>
      <!-- High straight wings — wider chord, less sweep -->
      <path d="M-4,-4 L-32,2 L-32,10 L-4,6 Z"/>
      <path d="M4,-4 L32,2 L32,10 L4,6 Z"/>
      <!-- Prop disc rings (the key visual differentiator!) -->
      <circle cx="-26" cy="4" r="8" fill="none" stroke="STROKE" stroke-width="1.5" opacity="0.8"/>
      <circle cx="26" cy="4" r="8" fill="none" stroke="STROKE" stroke-width="1.5" opacity="0.8"/>
      <!-- Prop cross hairs -->
      <line x1="-26" y1="-4" x2="-26" y2="12" stroke-width="1"/>
      <line x1="-34" y1="4" x2="-18" y2="4" stroke-width="1"/>
      <line x1="26" y1="-4" x2="26" y2="12" stroke-width="1"/>
      <line x1="18" y1="4" x2="34" y2="4" stroke-width="1"/>
      <!-- Small stabs -->
      <path d="M-3,18 L-14,24 L-13,27 L-3,22 Z"/>
      <path d="M3,18 L14,24 L13,27 L3,22 Z"/>
    </g>
  </svg>`,

  // HELICOPTER — distinctive rotor disc + elongated tail boom
  helicopter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="30" height="30">
    <g transform="translate(50,50)" fill="FILL" stroke="STROKE" stroke-width="1.2" stroke-linejoin="round">
      <!-- Fuselage pod — fat oval -->
      <ellipse cx="0" cy="0" rx="10" ry="15"/>
      <!-- Main rotor disc — large circle, no fill -->
      <circle cx="0" cy="-2" r="30" fill="none" stroke="STROKE" stroke-width="1.5" opacity="0.6"/>
      <!-- Rotor blades cross -->
      <line x1="-30" y1="-2" x2="30" y2="-2" stroke-width="2" opacity="0.8"/>
      <line x1="0" y1="-32" x2="0" y2="28" stroke-width="2" opacity="0.8"/>
      <!-- Tail boom -->
      <rect x="-2" y="15" width="4" height="20" rx="1"/>
      <!-- Tail rotor -->
      <line x1="-8" y1="34" x2="8" y2="34" stroke-width="2.5"/>
    </g>
  </svg>`,

  // LIGHT — tiny high-wing piston, very short & stubby, straight wings
  // Represents: Cessna 172, Piper, Diamond etc.
  light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="22" height="22">
    <g transform="translate(50,50)" fill="FILL" stroke="STROKE" stroke-width="1.3" stroke-linejoin="round">
      <!-- Fuselage — very stubby -->
      <ellipse cx="0" cy="2" rx="3" ry="18"/>
      <!-- Straight high wings — long span, thin chord -->
      <path d="M-3,-2 L-34,0 L-34,5 L-3,3 Z"/>
      <path d="M3,-2 L34,0 L34,5 L3,3 Z"/>
      <!-- Single prop disc -->
      <circle cx="0" cy="-18" r="6" fill="none" stroke="STROKE" stroke-width="1.5" opacity="0.8"/>
      <!-- Tiny V-tail -->
      <path d="M-2,14 L-12,20 L-11,23 L-2,17 Z"/>
      <path d="M2,14 L12,20 L11,23 L2,17 Z"/>
    </g>
  </svg>`,

  // GENERIC — simple arrow for anything unclassified
  generic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="24" height="24">
    <g transform="translate(50,50)" fill="FILL" stroke="STROKE" stroke-width="1.2" stroke-linejoin="round">
      <ellipse cx="0" cy="-2" rx="3.5" ry="28"/>
      <path d="M-3.5,-2 L-28,14 L-26,20 L-3.5,8 Z"/>
      <path d="M3.5,-2 L28,14 L26,20 L3.5,8 Z"/>
      <path d="M-3,22 L-14,30 L-13,33 L-3,26 Z"/>
      <path d="M3,22 L14,30 L13,33 L3,26 Z"/>
      <line x1="0" y1="21" x2="0" y2="30" stroke-width="2"/>
    </g>
  </svg>`,
};

// ── tar1090 ICAO type designator → [shapeName, scale] ────────────────────────
// Full ~1000-type database from tar1090/markers.js.
// Priority: exact typeDesignator match → typeDescription fallback → category.

const _ulac = ['cessna', 0.92];

const TypeDesignatorIcons = {
    'SHIP': ['blimp', 0.94], // Blimp
    'BALL': ['balloon', 1], // Balloon

    'A318': ['a319', 0.95], // shortened a320 68t
    'A319': ['a319', 1], // shortened a320 75t
    'A19N': ['a319', 1], // shortened a320
    'A320': ['a320', 1], // 78t
    'A20N': ['a320', 1],
    'A321': ['a321', 1], // stretched a320 93t
    'A21N': ['a321', 1], // stretched a320

    'A306': ['heavy_2e', 0.93],
    'A330': ['a332', 0.98],
    'A332': ['a332', 0.99],
    'A333': ['a332', 1.00],
    'A338': ['a332', 1.00], // 800 neo
    'A339': ['a332', 1.01], // 900 neo
    'DC10': ['md11', 0.92],
    'MD11': ['md11', 0.96],

    'A359': ['a359', 1.00],
    'A35K': ['a359', 1.02],

    'A388': ['a380', 1],

    // dubious since these are old-generation 737s
    // but the shape is similar
    'B731': ['b737', 0.90], // len: 29m
    'B732': ['b737', 0.92], // len: 31m

    'B735': ['b737', 0.96], // len: 31m
    'B733': ['b737', 0.98], // len: 33m
    'B734': ['b737', 0.98], // len: 36m

    // next generation
    'B736': ['b737', 0.96], // len: 31m
    'B737': ['b737', 1.00], // len: 33m
    'B738': ['b738', 1.00], // len: 39m
    'B739': ['b739', 1.00], // len: 42m

    // max
    'B37M': ['b737', 1.02], // len: 36m (not yet certified)
    'B38M': ['b738', 1.00], // len: 39m
    'B39M': ['b739', 1.00], // len: 42m
    'B3XM': ['b739', 1.01], // len: 44m (not yet certified)

    'P8': ['p8', 1.00],
    'P8 ?': ['p8', 1.00],

    'E737': ['e737', 1.00],

    'J328': ['airliner', 0.78], // 15t
    'E170': ['airliner', 0.82], // 38t
    'E75S/L': ['airliner', 0.82],
    'E75L': ['airliner', 0.82],
    'E75S': ['airliner', 0.82],  // 40t
    'A148': ['airliner', 0.83], // 43t
    'RJ70': ['b707', 0.68], // 38t
    'RJ85': ['b707', 0.68], // 42t
    'RJ1H': ['b707', 0.68], // 44t
    'B461': ['b707', 0.68], // 44t
    'B462': ['b707', 0.68], // 44t
    'B463': ['b707', 0.68], // 44t
    'E190': ['airliner', 0.81], // 52t
    'E195': ['airliner', 0.81], // 52t
    'E290': ['airliner', 0.82], // 56t
    'E295': ['airliner', 0.83], // 62t
    'BCS1': ['airliner', 0.835], // 64t
    'BCS3': ['airliner', 0.85], // 70t

    'B741': ['heavy_4e', 0.96],
    'B742': ['heavy_4e', 0.96],
    'B743': ['heavy_4e', 0.96],
    'B744': ['heavy_4e', 0.96],
    'B74D': ['heavy_4e', 0.96],
    'B74S': ['heavy_4e', 0.96],
    'B74R': ['heavy_4e', 0.96],
    'BLCF': ['heavy_4e', 0.96],
    'BSCA': ['heavy_4e', 0.96], // hah!
    'B748': ['heavy_4e', 0.98],

    'B752': ['heavy_2e', 0.9],
    'B753': ['heavy_2e', 0.9],

    'B772': ['heavy_2e', 1.00], // all pretty similar except for length
    'B773': ['heavy_2e', 1.02],
    'B77L': ['heavy_2e', 1.02],
    'B77W': ['heavy_2e', 1.04],

    'B701': ['b707', 1],
    'B703': ['b707', 1],
    'K35R': ['b707', 1],
    'K35E': ['b707', 1],

    'FA20': ['jet_swept', 0.92], // 13t
    'C680': ['jet_swept', 0.92], // 14t
    'C68A': ['jet_swept', 0.92], // 14t
    'YK40': ['jet_swept', 0.94], // 16t
    'C750': ['jet_swept', 0.94], // 17t
    'F2TH': ['jet_swept', 0.94], // 16t
    'FA50': ['jet_swept', 0.94], // 18t
    'CL30': ['jet_swept', 0.92], // 14t
    'CL35': ['jet_swept', 0.92],
    'F900': ['jet_swept', 0.96], // 21t
    'CL60': ['jet_swept', 0.96], // 22t
    'G200': ['jet_swept', 0.92], // 16t
    'G280': ['jet_swept', 0.92], // 18t
    'HA4T': ['jet_swept', 0.92], // 18t
    'FA7X': ['jet_swept', 0.96], // 29t
    'FA8X': ['jet_swept', 0.96], // 33t
    'GLF2': ['jet_swept', 0.96], // 29t
    'GLF3': ['jet_swept', 0.96], // 31t
    'GLF4': ['jet_swept', 0.96], // 34t
    'GA5C': ['jet_swept', 0.96], // 34t
    'GL5T': ['jet_swept', 0.98], // 40t
    'GLF5': ['jet_swept', 0.98], // 41t
    'GA6C': ['jet_swept', 0.98], // 41t
    'GLEX': ['jet_swept', 1], // 45t
    'GL6T': ['jet_swept', 1], // 45t
    'GLF6': ['jet_swept', 1], // 48t
    'GA7C': ['jet_swept', 1], // 48t
    'GA8C': ['jet_swept', 1], // 48t (fantasy type but in the database)
    'GL7T': ['jet_swept', 1], // 52t
    'E135': ['jet_swept', 0.92], // 20t
    'E35L': ['jet_swept', 0.92], // 24t
    'E145': ['jet_swept', 0.92], // 22t
    'E45X': ['jet_swept', 0.92], // 24t
    'E390': ['e390', 1],
    'CRJ1': ['jet_swept', 0.92], // 24t
    'CRJ2': ['jet_swept', 0.92], // 24t
    'F28': ['jet_swept', 0.93], // 32t
    'CRJ7': ['jet_swept', 0.94], // 34t
    'CRJ9': ['jet_swept', 0.96], // 38t
    'F70': ['jet_swept', 0.97], // 40
    'CRJX': ['jet_swept', 0.98], // 41t
    'F100': ['jet_swept', 1], // 45t
    'DC91': ['jet_swept', 1],
    'DC92': ['jet_swept', 1],
    'DC93': ['jet_swept', 1],
    'DC94': ['jet_swept', 1],
    'DC95': ['jet_swept', 1],
    'MD80': ['jet_swept', 1.06], // 60t
    'MD81': ['jet_swept', 1.06],
    'MD82': ['jet_swept', 1.06],
    'MD83': ['jet_swept', 1.06],
    'MD87': ['jet_swept', 1.06],
    'MD88': ['jet_swept', 1.06], // 72t
    'MD90': ['jet_swept', 1.06],
    'B712': ['jet_swept', 1.06], // 54t
    'B721': ['jet_swept', 1.10], // 80t
    'B722': ['jet_swept', 1.10], // 80t

    'T154': ['jet_swept', 1.12], // 100t

    'BE40': ['jet_nonswept', 1], // 7.3t
    'FA10': ['jet_nonswept', 1], // 8t
    'C501': ['jet_nonswept', 1],
    'C510': ['jet_nonswept', 1],
    'C25A': ['jet_nonswept', 1],
    'C25B': ['jet_nonswept', 1],
    'C25C': ['jet_nonswept', 1],
    'C525': ['jet_nonswept', 1],
    'C550': ['jet_nonswept', 1],
    'C560': ['jet_nonswept', 1],
    'C56X': ['jet_nonswept', 1], // 9t
    'LJ23': ['jet_nonswept', 1],
    'LJ24': ['jet_nonswept', 1],
    'LJ25': ['jet_nonswept', 1],
    'LJ28': ['jet_nonswept', 1],
    'LJ31': ['jet_nonswept', 1],
    'LJ35': ['jet_nonswept', 1], // 8t
    'LR35': ['jet_nonswept', 1], // wrong but in DB
    'LJ40': ['jet_nonswept', 1],
    'LJ45': ['jet_nonswept', 1],
    'LR45': ['jet_nonswept', 1], // wrong but in DB
    'LJ55': ['jet_nonswept', 1],
    'LJ60': ['jet_nonswept', 1], // 10t
    'LJ70': ['jet_nonswept', 1],
    'LJ75': ['jet_nonswept', 1],
    'LJ85': ['jet_nonswept', 1],

    'C650': ['jet_nonswept', 1.03], // 11t
    'ASTR': ['jet_nonswept', 1.03], // 11t
    'G150': ['jet_nonswept', 1.03], // 11t
    'H25A': ['jet_nonswept', 1.03], // 12t
    'H25B': ['jet_nonswept', 1.03], // 12t
    'H25C': ['jet_nonswept', 1.03], // 12t

    'PRM1': ['jet_nonswept', 0.96],
    'E55P': ['jet_nonswept', 0.96],
    'E50P': ['jet_nonswept', 0.96],
    'EA50': ['jet_nonswept', 0.96],
    'HDJT': ['jet_nonswept', 0.96],
    'SF50': ['jet_nonswept', 0.94],

    'C97': ['super_guppy', 1],
    'SGUP': ['super_guppy', 1],
    'A3ST': ['beluga', 1],
    'A337': ['beluga', 1.06],
    'WB57': ['wb57', 1],

    'A37': ['hi_perf', 1],
    'A700': ['hi_perf', 1],
    'LEOP': ['hi_perf', 1],
    'ME62': ['hi_perf', 1],
    'T2': ['hi_perf', 1],
    'T37': ['hi_perf', 1],
    'T38': ['t38', 1],
    'F104': ['t38', 1],
    'A10': ['a10', 1],
    'A3': ['hi_perf', 1],
    'A6': ['hi_perf', 1],
    'AJET': ['alpha_jet', 1],
    'AT3': ['hi_perf', 1],
    'CKUO': ['hi_perf', 1],
    'EUFI': ['typhoon', 1],
    'SB39': ['sb39', 1],
    'MIR2': ['mirage', 1],
    'KFIR': ['mirage', 1],
    'F1': ['hi_perf', 1],
    'F111': ['hi_perf', 1],
    'F117': ['hi_perf', 1],
    'F14': ['hi_perf', 1],
    'F15': ['md_f15', 1],
    'F16': ['hi_perf', 1],
    'F18': ['f18', 1],
    'F18H': ['f18', 1],
    'F18S': ['f18', 1],
    'F22': ['f35', 1],
    'F22A': ['f35', 1],
    'F35': ['f35', 1],
    'VF35': ['f35', 1],
    'L159': ['l159', 1],
    'L39': ['l159', 1],
    'F4': ['hi_perf', 1],
    'F5': ['f5_tiger', 1],
    'HUNT': ['hunter', 1],
    'LANC': ['lancaster', 1],
    'B17': ['lancaster', 1],
    'B29': ['lancaster', 1],
    'J8A': ['hi_perf', 1],
    'J8B': ['hi_perf', 1],
    'JH7': ['hi_perf', 1],
    'LTNG': ['hi_perf', 1],
    'M346': ['hi_perf', 1],
    'METR': ['hi_perf', 1],
    'MG19': ['hi_perf', 1],
    'MG25': ['hi_perf', 1],
    'MG29': ['hi_perf', 1],
    'MG31': ['hi_perf', 1],
    'MG44': ['hi_perf', 1],
    'MIR4': ['hi_perf', 1],
    'MT2': ['hi_perf', 1],
    'Q5': ['hi_perf', 1],
    'RFAL': ['rafale', 1],
    'S3': ['hi_perf', 1],
    'S37': ['hi_perf', 1],
    'SR71': ['hi_perf', 1],
    'SU15': ['hi_perf', 1],
    'SU24': ['hi_perf', 1],
    'SU25': ['hi_perf', 1],
    'SU27': ['hi_perf', 1],
    'T22M': ['hi_perf', 1],
    'T4': ['hi_perf', 1],
    'TOR': ['tornado', 1],
    'A4': ['md_a4', 1],
    'TU22': ['hi_perf', 1],
    'VAUT': ['hi_perf', 1],
    'Y130': ['hi_perf', 1],
    'YK28': ['hi_perf', 1],
    'BE20': ['twin_large', 0.92],
    'IL62': ['il_62', 1],

    'MRF1': ['miragef1', 0.75],
    'M326': ['m326', 1],
    'M339': ['m326', 1],
    'FOUG': ['m326', 1],
    'T33': ['m326', 1],

    'A225': ['a225', 1],
    'A124': ['b707', 1.18],

    'SLCH': ['strato', 1],
    'WHK2': ['strato', 0.9],

    'C130': ['c130', 1.07],
    'C30J': ['c130', 1.07],

    'P3': ['p3_orion', 1],

    'PARA': ['para', 1],

    'DRON': ['uav', 1],
    'Q1': ['uav', 1],
    'Q4': ['uav', 1],
    'Q9': ['uav', 1],
    'Q25': ['uav', 1],
    'HRON': ['uav', 1],

    'A400': ['a400', 1],

    'V22F': ['v22_fast', 1],
    'V22': ['v22_slow', 1],
    'B609F': ['v22_fast', 0.86],
    'B609': ['v22_slow', 0.86],
    'H64': ['apache', 1],


    // 4 bladed heavy helicopters
    'H60': ['blackhawk', 1], // 11t
    'S92': ['blackhawk', 1], // 12t
    'NH90': ['blackhawk', 1], // 11t

    // Puma, Super Puma, Oryx, Cougar (ICAO'S AS32 & AS3B & PUMA)
    'AS32': ['puma', 1.03], // 9t
    'AS3B': ['puma', 1.03], // 9t
    'PUMA': ['puma', 1.03], // 9t

    'TIGR': ['tiger', 1.00],
    'MI24': ['mil24', 1.00],
    'AS65': ['dauphin', 0.85],
    'S76': ['dauphin', 0.86],
    'GAZL': ['gazelle', 1.00],
    'AS50': ['gazelle', 1.00],
    'AS55': ['gazelle', 1.00],
    'ALO2': ['gazelle', 1.00],
    'ALO3': ['gazelle', 1.00],

    'R22': ['helicopter', 0.92],
    'R44': ['helicopter', 0.94],
    'R66': ['helicopter', 0.98],

    // 5 bladed
    'EC55': ['s61', 0.94], // 5t
    'A169': ['s61', 0.94], // 5t
    'H160': ['s61', 0.95], // 6t
    'A139': ['s61', 0.96], // 7t
    'EC75': ['s61', 0.97], // 8t
    'A189': ['s61', 0.98], // 8.3t
    'A149': ['s61', 0.98], // 8.6t
    'S61': ['s61', 0.98], // 8.6t
    'S61R': ['s61', 1], // 10t
    'EC25': ['s61', 1.01], // 11t
    'EH10': ['s61', 1.04], // 14.5t (AW101)
    'H53': ['s61', 1.1], // 19t
    'H53S': ['s61', 1.1], // 19t

    'U2': ['u2', 1],
    'C2': ['c2', 1],
    'E2': ['c2', 1],
    'H47': ['chinook', 1],
    'H46': ['chinook', 1],
    'HAWK': ['bae_hawk', 1],

    'GYRO': ['gyrocopter', 1],
    'DLTA': ['verhees', 1],

    'B1': ['b1b_lancer', 1.0],
    'B52': ['b52', 1],
    'C17': ['c17', 1.25],
    'C5M': ['c5', 1.18],
    'E3TF': ['e3awacs', 0.88],
    'E3CF': ['e3awacs', 0.88],
    //
    'GLID': ['glider', 1],
    //Stemme
    'S6': ['glider', 1],
    'S10S': ['glider', 1],
    'S12': ['glider', 1],
    'S12S': ['glider', 1],
    //Schempp-Hirth
    'ARCE': ['glider', 1],
    'ARCP': ['glider', 1],
    'DISC': ['glider', 1],
    'DUOD': ['glider', 1],
    'JANU': ['glider', 1],
    'NIMB': ['glider', 1],
    'QINT': ['glider', 1],
    'VENT': ['glider', 1],
    'VNTE': ['glider', 1],
    //Schleicher
    'A20J': ['glider', 1],
    'A32E': ['glider', 1],
    'A32P': ['glider', 1],
    'A33E': ['glider', 1],
    'A33P': ['glider', 1],
    'A34E': ['glider', 1],
    'AS14': ['glider', 1],
    'AS16': ['glider', 1],
    'AS20': ['glider', 1],
    'AS21': ['glider', 1],
    'AS22': ['glider', 1],
    'AS24': ['glider', 1],
    'AS25': ['glider', 1],
    'AS26': ['glider', 1],
    'AS28': ['glider', 1],
    'AS29': ['glider', 1],
    'AS30': ['glider', 1],
    'AS31': ['glider', 1],
    //DG
    'DG80': ['glider', 1],
    'DG1T': ['glider', 1],
    'LS10': ['glider', 1],
    'LS9': ['glider', 1],
    'LS8': ['glider', 1],
    //Jonker
    'TS1J': ['glider', 1],
    //PIK
    'PK20': ['glider', 1],
    //LAK
    'LK17': ['glider', 1],
    'LK19': ['glider', 1],
    'LK20': ['glider', 1],

    'ULAC': _ulac,
    'EV97': _ulac,
    'FDCT': _ulac,
    'WT9': _ulac,
    'PIVI': _ulac,
    'FK9': _ulac,
    'AVID': _ulac,
    'NG5': _ulac,
    'PNR3': _ulac,
    'TL20': _ulac,

    'SR20': ['cirrus_sr22', 1],
    'SR22': ['cirrus_sr22', 1],
    'S22T': ['cirrus_sr22', 1],
    'VEZE': ['rutan_veze', 1],
    'VELO': ['rutan_veze', 1.04],

    'PRTS': ['rutan_veze', 1.3], // approximation for canard configuration

    'PA24': ['pa24', 1],

    'GND': ['ground_unknown', 1],
    'GRND': ['ground_unknown', 1],
    'SERV': ['ground_service', 1],
    'EMER': ['ground_emergency', 1],
    'TWR': ['ground_tower', 1],
};

// Maps ICAO aircraft type description codes (e.g. "L2J") to aircraft icons. This is used if the ICAO type designator (e.g. "B731")
// cannot be found in the TypeDesignatorIcons mappings. The key can be one of the following:
//   - Single character: The basic aircraft type letter code (e.g. "H" for helicopter).
//   - Three characters: The ICAO type description code (e.g. "L2J" for landplanes with 2 jet engines).
//   - Five characters: The ICAO type description code concatenated with the wake turbulence category code, separated by
//     a dash (e.g. "L2J-M")

// ── ICAO typeDescription (e.g. "L2J") → [shapeName, scale] ───────────────────
// Used when typeDesignator has no exact match.
// Key formats: single char ("H"), 3-char code ("L2J"), or 5-char with WTC ("L2J-M").
const TypeDescriptionIcons = {
    'H': ['helicopter', 1],
    'G': ['gyrocopter', 1],

    'L1P': ['cessna', 1],
    'A1P': ['cessna', 1],
    'L1T': ['single_turbo', 1],
    'L1J': ['hi_perf', 0.92],

    'L2P': ['twin_small', 1],
    'A2P': ['twin_large', 0.96],
    'A2P-M': ['twin_large', 1.12],
    'L2T': ['twin_large', 0.96],
    'L2T-M': ['twin_large', 1.12],
    'A2T': ['twin_large', 0.96],
    'A2T-M': ['twin_large', 1.06],


    'L1J-L': ['jet_nonswept', 1], // < 7t
    'L2J-L': ['jet_nonswept', 1], // < 7t
    'L2J-M': ['airliner', 1], // < 136t
    'L2J-H': ['heavy_2e', 0.96], // > 136t

    'L3J-H': ['md11', 1], // > 136t

    'L4T-M': ['c130', 1],
    'L4T-H': ['c130', 1.07],
    'L4T': ['c130', 0.96],

    'L4J-H': ['b707' , 1],
    'L4J-M': ['b707' , 0.8],
    'L4J': ['b707' , 0.8],
};

// ── ADS-B emitter category → [shapeName, scale] ───────────────────────────────
// Last-resort fallback when no type data is available.
const CategoryIcons = {
    "A1" : ['cessna', 1],// < 7t
    "A2" : ['jet_swept', 0.94], // < 34t
    "A3" : ['airliner', 0.96], // < 136t
    "A4" : ['airliner', 1], // < 136t
    "A5" : ['heavy_2e', 0.92], // > 136t
    "A6" : ['hi_perf', 0.94],
    "A7" : ['helicopter', 1],
    'B1': ['glider', 1],
    "B2" : ['balloon', 1],
    'B4': _ulac,
    'B6': ['uav', 1],
    'C0' : ['ground_unknown', 1],
    'C1' : ['ground_emergency', 1],
    'C2' : ['ground_service', 1],
    'C3' : ['ground_tower', 1],
};

// ── Aircraft classification → color ──────────────────────────────────────────
//   Commercial  = green   (#00e676)
//   Military    = red     (#f44336)
//   Other       = orange  (#ffa726)
//
// Classification uses (in priority order):
//   1. dbFlags bit 0 (military=1) from adsb.fi / ADSBex database
//   2. Known military ICAO hex ranges (AE0000–AFFFFF = US military, etc.)
//   3. Callsign pattern: IATA/ICAO airline prefix → commercial
//   4. Callsign pattern: military prefixes (RCH, RRR, CNV, etc.) → military

// Major military ICAO hex ranges (prefix matches)
// NOTE: Treat these as weak evidence unless reinforced by military dbFlags,
// callsign, or military-specific type code.
const MILITARY_HEX_PREFIXES = [
  'ae',           // United States military (AE0000–AFFFFF)
  '43c',          // United Kingdom military
  '3f4',          // Germany military
  '3a0',          // France military (Armée de l'air)
  // NOTE: '461' removed — this is Finland's civil ICAO block (460000–46FFFF), NOT Russia
  '7001', '7002', // China military
  '710',          // Japan JASDF
  '7c0',          // Australia military
  'c40',          // Canada military
  // NOTE: '4ca' removed — this is the entire Irish ICAO block (4C0000–4CFFFF),
  //       including all Aer Lingus/Ryanair/civilian EI- registrations.
  //       Irish Air Corps aircraft don't have a unique isolated prefix.
  '48c',          // Italy military
  '340',          // Spain military
];

// Military-specific airframe type codes.
const MILITARY_TYPE_PREFIXES = [
  'C17', 'C130', 'C135', 'KC', 'E3', 'E6', 'P8',
  'F15', 'F16', 'F18', 'F22', 'F35', 'B1', 'B2', 'B52',
  'A400', 'IL76', 'AN12', 'AN22', 'AN72', 'AN74',
];

// Well-known commercial airline ICAO 3-letter prefixes (callsign starts with these)
const AIRLINE_PREFIXES = new Set([
  'AAL','UAL','DAL','SWA','SKW','ASA','NKS','JBU','FFT','HAL',  // US majors
  'JIA','ENY','RPA','EDV','MXY','AAY','NKS','JBU','JZA','QXE',  // US/CA regional + ULCC
  'BAW','EZY','RYR','VIR','TOM','MON','LOG','TCX','EXS',        // UK
  'AFR','AEE','IBE','VLG','TAP','KLM','DLH','LFT','BEL','SWR',  // Europe
  'AUA','SAS','FIN','LOT','TAR','CSA','EWG','TUI','WZZ','NAX',  // Europe
  'UAE','ETD','QTR','SVA','ELY','MEA','THY','MSR','KAC',        // Middle East
  'QTR','UAE','ETD','ABY','FDB','JZR','AIZ','OMA','QJE',        // Gulf / ME low-cost
  'SIA','CPA','CES','CSN','MAS','THA','GIA','PAL','AIC','ANA',  // Asia
  'JAL','KAL','AAR','JNA','AIQ','IGO','AXB','VTI','CCA','HDA',  // Asia
  'CSH','CES','CSN','CHH','XAX','HVN','VJC','SJO','AMU','ALK',  // Asia
  'QFA','ANZ','JST','VOZ','RXA','QJE','QLK',                    // Pacific
  'ETH','KQA','SAA','RAM','TSC','MAU','DAH','RWD','EWA',        // Africa
  'TAM','GLO','AVA','LAN','AZU','BOA','CMP','AMX','VOI','VIV',  // Latin America
  'ARG','LPE','SKX','ACA','WJA','JBU','DAL','AAL','UAL',        // Americas interline
  'FDX','UPS','ABX','ATN','GTI',                                // Cargo
  'CJT','CLX','BOX','DHK','NCA','KAL','CKK','MNB','BCS',        // Cargo international
]);

// Known military callsign prefixes
const MILITARY_CALLSIGN_PREFIXES = [
  'RCH',  // US Air Mobility Command (Reach)
  'CNV',  // US Navy Convey
  'RRR',  // RAF tankers
  'IRON', // USAF
  'JAKE', 'SKULL','VIPER','KNIFE','GHOST','DEMON','REAPER',
  'NCO',  // NATO
  'GRZLY','VALOR','BLADE','SWORD','LANCE',
  'NATO',
  'ALLO', // French military
  'GAF',  // German Air Force
  'SHF',  // SHAPE
];

// OpenSky / ADS-B emitter category values that are strongly commercial-like.
// Source: OpenSky state vector category documentation.
const COMMERCIAL_NUMERIC_CATEGORIES = new Set([2, 3, 4, 5, 6]);

function normalizeCategory(cat) {
  if (typeof cat === 'number' && Number.isFinite(cat)) return cat;
  if (typeof cat === 'string') {
    const s = cat.trim().toUpperCase();
    // READSB-like providers often use A0..A7 strings.
    if (/^[AB][0-9]$/.test(s)) return s;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isLikelyCommercialCallsign(cs) {
  if (!cs) return false;
  if (MILITARY_CALLSIGN_PREFIXES.some(p => cs.startsWith(p))) return false;

  // Typical airline format: 2-3 letter designator + flight number + optional 1-2 letter suffix.
  // Allow up to 2 suffix letters (e.g. EIN7AC, BAW234A).
  const m = cs.match(/^([A-Z]{2,3})(\d{1,4})([A-Z]{0,2})$/);
  if (!m) return false;

  const prefix = m[1];
  if (prefix.length === 3) return true; // Most ICAO operators are 3-letter codes
  return AIRLINE_PREFIXES.has(prefix);
}

function classifyAircraft(a) {
  const squawk = String(a.squawk ?? '').trim();
  const emergencyCode = ['7500', '7600', '7700'].includes(squawk);
  const emergencyFlag = String(a.emergency ?? '').toLowerCase();
  const isEmergency = emergencyCode || (emergencyFlag && emergencyFlag !== 'none');
  if (isEmergency) return 'emergency';

  if (a.onGround === true) return 'ground';

  // 1) Extract reusable evidence signals
  const cs = (a.callsign ?? '').toUpperCase().trim();
  const prefix3 = cs.slice(0, 3);
  const hasMilitaryCallsign = !!cs && MILITARY_CALLSIGN_PREFIXES.some(p => cs.startsWith(p));
  const hasCommercialCallsign = isLikelyCommercialCallsign(cs)
    || (!!cs && AIRLINE_PREFIXES.has(prefix3) && /\d/.test(cs));
  const category = normalizeCategory(a.category);
  const hasCommercialCategory = typeof category === 'number' && COMMERCIAL_NUMERIC_CATEGORIES.has(category);

  // 2) Strong direct signals
  if ((a.dbFlags ?? 0) & 1) return 'military';
  if (hasMilitaryCallsign) return 'military';
  if (hasCommercialCallsign || hasCommercialCategory) return 'commercial';

  // 3) Airframe evidence
  const typecode = (a.typecode ?? '').toUpperCase().trim();
  const hasMilitaryType = !!typecode && MILITARY_TYPE_PREFIXES.some(p => typecode.startsWith(p));
  if (hasMilitaryType) return 'military';

  // 4) Known military ICAO hex prefix (weak evidence). To reduce false
  // positives, do NOT use this if we already saw commercial category data.
  const hexLow = (a.id ?? '').toLowerCase();
  if (!hasCommercialCategory && MILITARY_HEX_PREFIXES.some(p => hexLow.startsWith(p))) {
    return 'military';
  }

  // 5) Fallback
  if (cs) {
    if (isLikelyCommercialCallsign(cs)) return 'commercial';
  }

  return 'commercial';
}

function classificationColor(classification) {
  switch ((classification ?? 'commercial').toLowerCase()) {
    case 'emergency': return '#ef4444';
    case 'military': return '#f97316';
    case 'ground': return '#6b7280';
    case 'commercial':
    default:
      return '#60a5fa';
  }
}

function aircraftColor(a) {
  return classificationColor(classifyAircraft(a));
}

// Keep for HUD panel badge (mirrors classification color)
function altitudeColor(altFt) { return '#00e676'; } // stub — no longer used for icons

// ── Shape selection — tar1090 lookup priority ─────────────────────────────────
// 1. Exact ICAO type designator (TypeDesignatorIcons)
// 2. typeDescription + WTC (TypeDescriptionIcons, 5-char key)
// 3. typeDescription alone (TypeDescriptionIcons, 3-char)
// 4. typeDescription basic type letter (TypeDescriptionIcons, 1-char)
// 5. ADS-B category (CategoryIcons)
// 6. Altitude proxy (last resort)
// Returns the shape *name* string (key into SHAPES).

function getShape(a) {
  // Enrich aircraft object with DB info if available
  enrichAircraftFromDb(a);
  const tc  = (a.typecode ?? '').toUpperCase().trim();
  const cat = (a.category ?? '').toUpperCase().trim();

  // 1. Exact type designator match
  if (tc && tc in TypeDesignatorIcons) {
    return TypeDesignatorIcons[tc][0];
  }

  // 2–4. typeDescription fallback (adsb.fi provides this as a.typeDescription)
  const td  = (a.typeDescription ?? '').toUpperCase().trim();
  const wtc = (a.wtc ?? '').toUpperCase().trim();

  if (td.length === 3) {
    // 2. With WTC suffix e.g. "L2J-M"
    if (wtc.length === 1) {
      const key5 = td + '-' + wtc;
      // Special case: L2J-M + A2 category → swept jet
      if (key5 === 'L2J-M' && cat === 'A2') return 'jet_swept';
      if (key5 in TypeDescriptionIcons) return TypeDescriptionIcons[key5][0];
    }
    // 3. Without WTC
    if (td in TypeDescriptionIcons) return TypeDescriptionIcons[td][0];
    // 4. Basic type letter only
    const basicType = td.charAt(0);
    if (basicType in TypeDescriptionIcons) return TypeDescriptionIcons[basicType][0];
  } else if (td.length === 1 && td in TypeDescriptionIcons) {
    return TypeDescriptionIcons[td][0];
  }

  // 5. ADS-B category
  if (cat && cat in CategoryIcons) return CategoryIcons[cat][0];

  // Regex catch-alls for common type-code patterns not in explicit tables
  if (tc) {
    if (/^H\d/.test(tc) || /^S(6|7|9)\d/.test(tc) || /^(EC|BO|BK|AS|AW|MD9)/.test(tc))
      return 'helicopter';
    if (/^(B74|B77|A38|A34)/.test(tc)) return 'heavy_4e';
    if (/^(B76|B78|A3[03]|A35)/.test(tc)) return 'heavy_2e';
    if (/^(B7|A3|E1|E17|E19|CRJ|RJ|F\d)/.test(tc)) return 'airliner';
  }

  // 6. Altitude proxy (absolute last resort)
  const alt = a.altFt ?? 0;
  if (alt > 25000) return 'airliner';
  if (alt > 5000)  return 'twin_large';
  if (alt > 0)     return 'cessna';
  return 'unknown';
}

// ── Build a data URI for a given shape + color ────────────────────────────────

const svgCache = new Map();

// Contrasting glow color per aircraft class color
function glowColor(fillColor) {
  // Dark fills get a white glow; produce contrast against globe surface
  const dark = ['#f44336','#ab47bc','#ce93d8','#ef5350'];
  return dark.includes(fillColor) ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.95)';
}

// ── Render a tar1090 shape object into inner SVG content ─────────────────────
// Converts the path/accent fields into two paint-pass <g> groups that the
// existing glow pipeline expects: one glow-stroke pass and one filled pass.
function shapeToInnerSvg(shapeDef, fillColor, strokeColor) {
  const sw = 2 * (shapeDef.strokeScale ?? 1);
  let paths = shapeDef.path;
  if (!Array.isArray(paths)) paths = paths ? [paths] : [];

  let inner = '';
  for (const d of paths) {
    inner += `<path paint-order="stroke" fill="${fillColor}" stroke="${strokeColor}" `
           + `stroke-width="${sw}" d="${d}"/>`;
  }

  if (shapeDef.accent) {
    const accentSw = 0.6 * (shapeDef.accentMult ?? 1) * (shapeDef.strokeScale ?? 1);
    let accents = shapeDef.accent;
    if (!Array.isArray(accents)) accents = [accents];
    for (const d of accents) {
      inner += `<path fill="none" stroke="${strokeColor}" stroke-width="${accentSw}" d="${d}"/>`;
    }
  }

  return inner;
}

function buildSvgUri(shape, color) {
  const key = `${shape}:${color}`;
  if (svgCache.has(key)) return svgCache.get(key);

  const glow   = glowColor(color);
  const rawSvg = SHAPES[shape] ?? SHAPES.generic;

  // Extract just the transform from the original <g> tag — strip fill/stroke placeholders
  const gTagMatch = rawSvg.match(/<g([^>]*)>/);
  const rawAttribs = gTagMatch ? gTagMatch[1] : ' transform="translate(50,50)"';
  // Keep only the transform attribute, discard fill/stroke/stroke-width from template
  const xformMatch = rawAttribs.match(/transform="([^"]+)"/);
  const xform      = xformMatch ? ` transform="${xformMatch[1]}"` : '';

  const innerMatch = rawSvg.match(/<g[^>]*>([\s\S]*?)<\/g>/);
  const inner      = innerMatch ? innerMatch[1] : '';

  const vb = (rawSvg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 100 100';
  const w  = 320;
  const h  = 320;

  // Two clean paint passes sharing only the transform:
  //   Pass 1 — wide glow stroke, no fill (drawn behind)
  //   Pass 2 — filled shape with thin stroke (drawn on top)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">
  <g${xform} fill="none" stroke="${glow}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${inner}</g>
  <g${xform} fill="${color}" stroke="${glow}" stroke-width="1" stroke-linejoin="round">${inner}</g>
</svg>`;

  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  svgCache.set(key, uri);
  return uri;
}

// ── 3-D GLB model builder (used only in follow mode) ─────────────────────────

function mergeMeshes(meshes) {
  let tv = 0, ti = 0;
  for (const m of meshes) { tv += m.verts.length; ti += m.idx.length; }
  const verts = new Float32Array(tv), idx = new Uint16Array(ti);
  let vo = 0, io = 0, vbase = 0;
  for (const m of meshes) {
    verts.set(m.verts, vo);
    for (const i of m.idx) idx[io++] = i + vbase;
    vbase += m.verts.length / 3; vo += m.verts.length;
  }
  return { verts, idx };
}

function buildJetGeometry() {
  const meshes = [];
  const rings = [[20,.10,.10],[16,.80,.90],[8,1.2,1.3],[0,1.3,1.4],[-10,1.2,1.2],[-16,.80,.90],[-20,.20,.50]];
  const S = 8;
  for (let r = 0; r < rings.length-1; r++) {
    const [x0,w0,h0] = rings[r], [x1,w1,h1] = rings[r+1];
    const v=[], ix=[];
    for (let i=0;i<S;i++){const a=(i/S)*Math.PI*2; v.push(x0,Math.sin(a)*h0,Math.cos(a)*w0);}
    for (let i=0;i<S;i++){const a=(i/S)*Math.PI*2; v.push(x1,Math.sin(a)*h1,Math.cos(a)*w1);}
    for (let i=0;i<S;i++){const j=(i+1)%S; ix.push(i,S+i,S+j,i,S+j,j);}
    meshes.push({verts:new Float32Array(v),idx:new Uint16Array(ix)});
  }
  const wT=[[8,.30,1.5],[-2,.80,24],[-6,.60,22],[-4,.05,1.2]];
  const wB=wT.map(([x,y,z])=>[x,y-.45,z]);
  const wA=[...wT,...wB.slice().reverse()];
  const wv=[],wi=[];
  for(const [x,y,z] of wA) wv.push(x,y,z);
  for(let i=1;i<wA.length-1;i++) wi.push(0,i,i+1);
  meshes.push({verts:new Float32Array(wv),idx:new Uint16Array(wi)});
  const wvL=new Float32Array(wv); for(let i=2;i<wvL.length;i+=3) wvL[i]=-wvL[i];
  meshes.push({verts:wvL,idx:new Uint16Array(wi)});
  for(const [ex,ey,ez] of [[2,-1,9],[2,-1,-9]]){
    const er=.55,el=5.5,es=8,ev=[],ei=[];
    for(let i=0;i<es;i++){const a=(i/es)*Math.PI*2; ev.push(ex+el/2,ey+Math.sin(a)*er,ez+Math.cos(a)*er);}
    for(let i=0;i<es;i++){const a=(i/es)*Math.PI*2; ev.push(ex-el/2,ey+Math.sin(a)*er,ez+Math.cos(a)*er);}
    for(let i=0;i<es;i++){const j=(i+1)%es; ei.push(i,es+i,es+j,i,es+j,j);}
    meshes.push({verts:new Float32Array(ev),idx:new Uint16Array(ei)});
  }
  const sT=[[-13,.30,1.3],[-17,.50,8],[-18,.35,7],[-15,.20,1.0]];
  const sA=[...sT,...sT.map(([x,y,z])=>[x,y-.25,z]).reverse()];
  const sv=[],si=[];
  for(const [x,y,z] of sA) sv.push(x,y,z);
  for(let i=1;i<sA.length-1;i++) si.push(0,i,i+1);
  meshes.push({verts:new Float32Array(sv),idx:new Uint16Array(si)});
  const svL=new Float32Array(sv); for(let i=2;i<svL.length;i+=3) svL[i]=-svL[i];
  meshes.push({verts:svL,idx:new Uint16Array(si)});
  meshes.push({
    verts:new Float32Array([-12,.5,.3,-19,7.5,.2,-19,7,-.2,-12,.5,-.3,-19,.5,.3,-19,.5,-.3]),
    idx:new Uint16Array([0,1,2,0,2,3,0,4,1,3,2,5]),
  });
  return mergeMeshes(meshes);
}

function buildHelicopterGeometry() {
  const meshes = [];

  // Main fuselage pod
  const rings = [[8,0.7,0.9],[4,1.3,1.5],[0,1.5,1.7],[-4,1.2,1.3],[-8,0.8,0.9]];
  const S = 10;
  for (let r = 0; r < rings.length - 1; r++) {
    const [x0,w0,h0] = rings[r], [x1,w1,h1] = rings[r + 1];
    const v = [], ix = [];
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      v.push(x0, Math.sin(a) * h0, Math.cos(a) * w0);
    }
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      v.push(x1, Math.sin(a) * h1, Math.cos(a) * w1);
    }
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      ix.push(i, S + i, S + j, i, S + j, j);
    }
    meshes.push({ verts: new Float32Array(v), idx: new Uint16Array(ix) });
  }

  // Tail boom
  meshes.push({
    verts: new Float32Array([
      -7.5,-0.2,-0.25,  -22,-0.2,-0.25,  -22,0.2,-0.25,  -7.5,0.2,-0.25,
      -7.5,-0.2,0.25,   -22,-0.2,0.25,   -22,0.2,0.25,   -7.5,0.2,0.25,
    ]),
    idx: new Uint16Array([
      0,1,2, 0,2,3, 4,6,5, 4,7,6,
      0,4,5, 0,5,1, 3,2,6, 3,6,7,
      0,3,7, 0,7,4, 1,5,6, 1,6,2,
    ]),
  });

  // Main rotor mast and blades (flat cross)
  meshes.push({
    verts: new Float32Array([
      -0.2,1.3,-0.2, 0.2,1.3,-0.2, 0.2,3.2,-0.2, -0.2,3.2,-0.2,
      -0.2,1.3,0.2,  0.2,1.3,0.2,  0.2,3.2,0.2,  -0.2,3.2,0.2,
      -0.35,3.3,-16, 0.35,3.3,-16, 0.35,3.3,16, -0.35,3.3,16,
      -16,3.3,-0.35, 16,3.3,-0.35, 16,3.3,0.35, -16,3.3,0.35,
    ]),
    idx: new Uint16Array([
      0,1,2, 0,2,3, 4,6,5, 4,7,6,
      0,4,5, 0,5,1, 3,2,6, 3,6,7,
      8,9,10, 8,10,11,
      12,13,14, 12,14,15,
    ]),
  });

  // Tail rotor (small cross near tail end)
  meshes.push({
    verts: new Float32Array([
      -21.8,0.2,-2.4, -21.8,0.2,2.4, -22.2,0.2,2.4, -22.2,0.2,-2.4,
      -22.0,-2.2,-0.2, -22.0,2.2,-0.2, -22.0,2.2,0.2, -22.0,-2.2,0.2,
    ]),
    idx: new Uint16Array([
      0,1,2, 0,2,3,
      4,5,6, 4,6,7,
    ]),
  });

  return mergeMeshes(meshes);
}

const JET_MESH  = buildJetGeometry();
const HELI_MESH = buildHelicopterGeometry();
const glbCache  = new Map();

function buildGlbUrl(shape, hexColor) {
  const key = `${shape}:${hexColor}`;
  if (glbCache.has(key)) return glbCache.get(key);

  const mesh = shape === 'helicopter' ? HELI_MESH : JET_MESH;
  const {verts,idx} = mesh;
  const hex=hexColor.replace('#','');
  const r=parseInt(hex.slice(0,2),16)/255, g=parseInt(hex.slice(2,4),16)/255, b=parseInt(hex.slice(4,6),16)/255;
  const vb=verts.buffer, ib=idx.buffer, vl=vb.byteLength, il=ib.byteLength, bl=vl+il;
  const bp=(4-(bl%4))%4, bcl=bl+bp;
  let mnX=Infinity,mnY=Infinity,mnZ=Infinity,mxX=-Infinity,mxY=-Infinity,mxZ=-Infinity;
  for(let i=0;i<verts.length;i+=3){
    mnX=Math.min(mnX,verts[i]);  mxX=Math.max(mxX,verts[i]);
    mnY=Math.min(mnY,verts[i+1]);mxY=Math.max(mxY,verts[i+1]);
    mnZ=Math.min(mnZ,verts[i+2]);mxZ=Math.max(mxZ,verts[i+2]);
  }
  const json=JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0,mode:4}]}],
    materials:[{pbrMetallicRoughness:{baseColorFactor:[r,g,b,1],metallicFactor:.3,roughnessFactor:.5},doubleSided:true}],
    accessors:[
      {bufferView:0,componentType:5126,count:verts.length/3,type:'VEC3',min:[mnX,mnY,mnZ],max:[mxX,mxY,mxZ]},
      {bufferView:1,componentType:5123,count:idx.length,type:'SCALAR',min:[0],max:[verts.length/3-1]},
    ],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:vl,target:34962},{buffer:0,byteOffset:vl,byteLength:il,target:34963}],
    buffers:[{byteLength:bl}],
  });
  const jp=(4-(json.length%4))%4, js=json+' '.repeat(jp), jb=new TextEncoder().encode(js), jl=jb.length;
  const tl=12+8+jl+8+bcl, buf=new ArrayBuffer(tl), dv=new DataView(buf); let off=0;
  dv.setUint32(off,0x46546C67,true);off+=4; dv.setUint32(off,2,true);off+=4; dv.setUint32(off,tl,true);off+=4;
  dv.setUint32(off,jl,true);off+=4; dv.setUint32(off,0x4E4F534A,true);off+=4;
  new Uint8Array(buf,off,jl).set(jb);off+=jl;
  dv.setUint32(off,bcl,true);off+=4; dv.setUint32(off,0x004E4942,true);off+=4;
  new Uint8Array(buf,off,vl).set(new Uint8Array(vb));off+=vl;
  new Uint8Array(buf,off,il).set(new Uint8Array(ib));
  const url=URL.createObjectURL(new Blob([buf],{type:'model/gltf-binary'}));
  glbCache.set(key,url); return url;
}

const MODEL_SCALE = { heavy:1.4, widebody:1.2, jet:1.0, turboprop:.7, helicopter:.4, light:.25, generic:.9 };

const ICON_SIZE_PX = {
  // ── Airbus narrow-body ────────────────────────────────────────────────────
  a319: 34,  a320: 36,  a321: 38,
  // ── Widebody / heavy ─────────────────────────────────────────────────────
  a332: 40,  a359: 40,
  heavy_4e: 46,  heavy_2e: 44,  md11: 42,
  // ── Boeing 737 ───────────────────────────────────────────────────────────
  b737: 36,  b738: 36,
  // ── Airliner / regional ───────────────────────────────────────────────────
  airliner: 34,
  // ── Business jets ────────────────────────────────────────────────────────
  jet_swept: 32,  jet_nonswept: 30,
  // ── High-performance / military ──────────────────────────────────────────
  hi_perf: 32,
  // ── Military transport ────────────────────────────────────────────────────
  c130: 36,
  // ── Turboprop ────────────────────────────────────────────────────────────
  twin_large: 32,  twin_small: 28,  single_turbo: 28,
  // ── Helicopter ───────────────────────────────────────────────────────────
  helicopter: 34,  puma: 32,
  // ── Light piston ─────────────────────────────────────────────────────────
  cessna: 28,
  // ── Special ──────────────────────────────────────────────────────────────
  uav: 30,  glider: 30,  balloon: 26,
  ground_unknown: 20,
  unknown: 28,
};

// ── Aircraft type code → asset model filename mapping ────────────────────────
// Maps ICAO aircraft type codes to their corresponding .glb models in src/assets
// Examples: B739 → b739.glb, A320 → a320.glb
// Fallback uses procedural models if specific type is not found

const AIRCRAFT_MODEL_MAP = new Map([
  // Airbus narrow-body
  ['A318', '3d_aircraft_models/a318.glb'],
  ['A319', '3d_aircraft_models/a319.glb'],
  ['A320', '3d_aircraft_models/a320.glb'],
  ['A321', '3d_aircraft_models/a321.glb'],
  // Airbus wide-body
  ['A332', '3d_aircraft_models/a332.glb'],
  ['A333', '3d_aircraft_models/a333.glb'],
  ['A343', '3d_aircraft_models/a343.glb'],
  ['A346', '3d_aircraft_models/a346.glb'],
  ['A359', '3d_aircraft_models/a359.glb'],
  ['A380', '3d_aircraft_models/a380.glb'],
  // Boeing narrow-body
  ['B736', '3d_aircraft_models/b736.glb'],
  ['B737', '3d_aircraft_models/b737.glb'],
  ['B738', '3d_aircraft_models/b738.glb'],
  ['B739', '3d_aircraft_models/b739.glb'],
  // Boeing wide-body
  ['B744', '3d_aircraft_models/b744.glb'],
  ['B748', '3d_aircraft_models/b748.glb'],
  ['B752', '3d_aircraft_models/b752.glb'],
  ['B753', '3d_aircraft_models/b753.glb'],
  ['B762', '3d_aircraft_models/b762.glb'],
  ['B763', '3d_aircraft_models/b763.glb'],
  ['B764', '3d_aircraft_models/b764.glb'],
  ['B772', '3d_aircraft_models/b772.glb'],
  ['B773', '3d_aircraft_models/b773.glb'],
  ['B788', '3d_aircraft_models/b788.glb'],
  ['B789', '3d_aircraft_models/b789.glb'],
  // Other commercial
  ['ATR42', '3d_aircraft_models/atr42.glb'],
  ['BAE146', '3d_aircraft_models/bae146.glb'],
  ['CRJ700', '3d_aircraft_models/crj700.glb'],
  ['CRJ900', '3d_aircraft_models/crj900.glb'],
  ['CS100', '3d_aircraft_models/cs100.glb'],
  ['CS300', '3d_aircraft_models/cs300.glb'],
  ['E170', '3d_aircraft_models/e170.glb'],
  ['E190', '3d_aircraft_models/e190.glb'],
  ['Q400', '3d_aircraft_models/q400.glb'],
  // Cargo/Military
  ['AN225', '3d_aircraft_models/an225.gltf'],
  ['BELUGA', '3d_aircraft_models/beluga.glb'],
  // General aviation
  ['PA28', '3d_aircraft_models/pa28.glb'],
  ['C172', '3d_aircraft_models/pa28.glb'],
  ['ASK21', '3d_aircraft_models/ask21.glb'],
]);

/**
 * Get the 3D model URL for an aircraft type.
 * First tries to load from /src/assets/3d_aircraft_models/{typecode}.glb, then falls back to procedural generation.
 * @param {string} typecode - ICAO aircraft type code (e.g. 'B739', 'A320')
 * @param {string} shape - Aircraft shape (jet, helicopter, etc.)
 * @param {string} color - Hex color code
 * @returns {string} URL to the model (either asset URL or data: URI for procedural model)
 */
function getAircraftModelUrl(typecode, shape, color) {
  if (!typecode) {
    // No type code, fall back to procedural
    return buildGlbUrl(shape, color);
  }

  const typecodeLower = typecode.toLowerCase();
  // Try direct match first
  const assetFilename = AIRCRAFT_MODEL_MAP.get(typecode.toUpperCase()) || 
                       AIRCRAFT_MODEL_MAP.get(typecode);
  
  if (assetFilename) {
    // Return the asset URL — Vite will handle the import
    return `/src/assets/${assetFilename}`;
  }

  // No specific asset found, fall back to procedural model
  console.debug(`[Flights] No asset model for ${typecode}, using procedural ${shape} model`);
  return buildGlbUrl(shape, color);
}

/**
 * Check if an aircraft type has a 3D model in the assets folder.
 * @param {string} typecode - ICAO aircraft type code
 * @returns {boolean} True if an asset model exists for this type
 */
export function hasAssetModel(typecode) {
  if (!typecode) return false;
  return AIRCRAFT_MODEL_MAP.has(typecode.toUpperCase());
}


// ── State ─────────────────────────────────────────────────────────────────────

/** @type {Map<string, Cesium.Entity>} */
const entityMap = new Map();
const trackStateMap = new Map();
const trackPosPropMap = new Map();
// Enriched typecodes from HUD lookup (adsbdb/hexdb) keyed by lowercase ICAO hex.
// These survive update cycles (OpenSky never sends typecodes) and entity re-creation.
const enrichedTypecodeMap = new Map();

/**
 * Store a HUD-enriched typecode for an aircraft and update its entity property.
 * Called from HUD.js after fetchAircraftInfo resolves the type code.
 */
export function setEnrichedTypecode(icaoHex, typecode) {
  if (!icaoHex || !typecode) return;
  const key = icaoHex.toLowerCase();
  enrichedTypecodeMap.set(key, typecode.toUpperCase());
  // Update entity if it exists in the current viewport
  const entity = entityMap.get(key);
  if (entity?.properties?.typecode?.setValue) {
    entity.properties.typecode.setValue(typecode.toUpperCase());
  }
}
let enabled     = false;  // Start disabled by default
let oskToken    = null;
let oskTokenExp = 0;
let hideAllFlatIcons = false;
let flightFeedHealthy = true;
let hasPublishedFlightOk = false;
let lastFlightStatusKey = '';
let flightZonesDataSource = null;
let noflyGpsPollTimer = null;
let noflyGpsPayloadCache = null;

const FLIGHT_ZONE_AGE_RULES = { fadeMs: 6 * 60 * 60 * 1000, expireMs: 48 * 60 * 60 * 1000 };

// Aircraft classification filter state — Tarsyu-style categories
const aircraftClassificationFilters = {
  commercial: true,
  military: true,
  emergency: true,
  ground: true,
};

const flightZoneFilters = {
  gps: true,
  airspace: true,
};

/**
 * Returns true if at least one aircraft classification is active.
 * When false, there is no point fetching flight data from the proxy.
 */
function isAnyClassificationActive() {
  return Object.values(aircraftClassificationFilters).some(Boolean);
}

/**
 * Determine if a flight entity should be visible based on enabled state and filters
 */
function shouldShowFlight(aircraftClassification) {
  if (!enabled) return false;
  const classKey = (aircraftClassification ?? 'commercial').toLowerCase();
  return aircraftClassificationFilters[classKey];
}

const EARTH_RADIUS_M = 6378137;
const KTS_TO_MPS = 0.514444;
const FTMIN_TO_MPS = 0.00508;
const MAX_PREDICT_SECONDS = 45;

function iconRotationFromHeading(headingDeg = 0) {
  // Billboard rotation is clockwise from north when alignedAxis is UNIT_Z.
  return Cesium.Math.toRadians(-(headingDeg ?? 0));
}

function publishSystemStatus(msg, level = 'ok', key = `${level}:${msg}`) {
  if (lastFlightStatusKey === key) return;
  lastFlightStatusKey = key;
  if (typeof window === 'undefined') return;

  const ts = Date.now();
  window.__shadowgridSystemStatus = { msg, level, key, source: 'flights', ts };
  window.__shadowgridSubsystemStatus = {
    ...(window.__shadowgridSubsystemStatus ?? {}),
    flights: { msg, level, key, ts },
  };

  window.dispatchEvent(new CustomEvent('shadowgrid:system-status', {
    detail: { msg, level, source: 'flights', key, ts },
  }));
}

function applyFlatIconVisibility() {
  for (const [id, entity] of entityMap) {
    const state = trackStateMap.get(id);
    const aircraftClassification = state?.aircraftClassification ?? 'commercial';
    const shouldShow = shouldShowFlight(aircraftClassification) && !hideAllFlatIcons;
    if (entity.billboard) {
      entity.billboard.show = new Cesium.ConstantProperty(shouldShow);
    }
    if (entity.label) {
      entity.label.show = new Cesium.ConstantProperty(shouldShow);
    }
  }
}

function flattenPoints(points) {
  const out = [];
  for (const [lon, lat] of points) out.push(lon, lat);
  return out;
}

function flattenClosedPoints(points) {
  if (!points.length) return [];
  return flattenPoints([...points, points[0]]);
}

function normalizeZonePoints(points) {
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

function parseZoneTime(value) {
  const ts = Date.parse(value ?? '');
  return Number.isFinite(ts) ? ts : null;
}

function computeFlightZoneOpacity(zone, nowMs) {
  const startsAt = parseZoneTime(zone.startsAt);
  const endsAt = parseZoneTime(zone.endsAt);
  const observedAt = parseZoneTime(zone.updatedAt) ?? parseZoneTime(zone.observedAt) ?? startsAt;

  if (startsAt && startsAt > nowMs) return 0;
  if (endsAt && nowMs <= endsAt) return 1;
  if (!observedAt) return 1;

  const ageMs = Math.max(0, nowMs - observedAt);
  if (ageMs <= FLIGHT_ZONE_AGE_RULES.fadeMs) return 1;
  if (ageMs >= FLIGHT_ZONE_AGE_RULES.expireMs) return 0;
  return 1 - ((ageMs - FLIGHT_ZONE_AGE_RULES.fadeMs) / (FLIGHT_ZONE_AGE_RULES.expireMs - FLIGHT_ZONE_AGE_RULES.fadeMs));
}

function buildZoneWindowLabel(zone) {
  const startsAt = zone.startsAt ? new Date(zone.startsAt).toISOString() : null;
  const endsAt = zone.endsAt ? new Date(zone.endsAt).toISOString() : null;
  const updatedAt = zone.updatedAt ? new Date(zone.updatedAt).toISOString() : null;
  if (startsAt && endsAt) return `${startsAt} to ${endsAt}`;
  if (updatedAt) return `Updated ${updatedAt}`;
  return 'Unknown window';
}

function reserveFlightZoneId(baseId, usedIds) {
  const seed = String(baseId ?? 'zone');
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

function addFlightRestrictionZone(zone, nowMs, maxHeight, usedIds) {
  const points = normalizeZonePoints(zone.points);
  const opacity = computeFlightZoneOpacity(zone, nowMs);
  if (points.length < 3 || opacity <= 0 || !flightZonesDataSource) return;

  const source = String(zone.source ?? '').toLowerCase();
  const isSafeAirspace = source.includes('safe airspace') || String(zone.zoneType ?? '').toLowerCase() === 'safeairspace';
  const severity = String(zone.severity ?? '').toLowerCase();
  const isHigh = severity === 'high';
  const displaySeverity = isHigh ? 'restricted airspace' : (zone.severity ?? 'medium');
  const ffaEvenColor = Cesium.Color.fromCssColorString(isHigh ? '#ff3b30' : '#ff7f73').withAlpha(0.34 * opacity);
  const ffaOddColor = Cesium.Color.fromCssColorString('#ffd4cd').withAlpha(0.08 * opacity);
  const faaOutline = Cesium.Color.fromCssColorString(isHigh ? '#ff655c' : '#ff9f96').withAlpha(0.92 * opacity);
  const safeAirspaceCss = severity === 'high'
    ? '#ea283c'
    : (severity === 'medium' ? '#ff8b00' : '#ffce00');
  const safeAirspaceFill = Cesium.Color.fromCssColorString(safeAirspaceCss).withAlpha((severity === 'high' ? 0.24 : 0.2) * opacity);
  const safeAirspaceOutline = Cesium.Color.fromCssColorString(safeAirspaceCss).withAlpha(0.95 * opacity);
  const material = isSafeAirspace
    ? safeAirspaceFill
    : new Cesium.StripeMaterialProperty({
      evenColor: ffaEvenColor,
      oddColor: ffaOddColor,
      repeat: 18,
      offset: 0.2,
      orientation: Cesium.StripeOrientation.VERTICAL,
    });
  const outline = isSafeAirspace ? safeAirspaceOutline : faaOutline;
  const zoneSeverity = isSafeAirspace ? (zone.severity ?? 'low') : displaySeverity;

  flightZonesDataSource.entities.add({
    id: reserveFlightZoneId(zone.id, usedIds),
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(flattenPoints(points)),
      height: 0,
      extrudedHeight: maxHeight,
      material,
      outline: false,
    },
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flattenClosedPoints(points)),
      width: isSafeAirspace ? 3 : 2,
      clampToGround: true,
      material: outline,
    },
    properties: {
      type: 'zone',
      domain: 'flight',
      id: zone.id,
      name: zone.name,
      zoneType: zone.zoneType ?? 'tfr',
      severity: zoneSeverity,
      source: zone.source ?? 'FAA',
      status: zone.status ?? 'active',
      activeWindowUtc: buildZoneWindowLabel(zone),
      summary: zone.summary ?? '',
    },
  });
}

function addGpsInterferenceZone(zone, nowMs, maxHeight, usedIds) {
  const points = normalizeZonePoints(zone.points);
  const opacity = computeFlightZoneOpacity(zone, nowMs);
  if (points.length < 3 || opacity <= 0 || !flightZonesDataSource) return;

  const fill = Cesium.Color.fromCssColorString(zone.severity === 'high' ? '#ff3b30' : '#ffd54a').withAlpha((zone.severity === 'high' ? 0.22 : 0.18) * opacity);
  const outline = Cesium.Color.fromCssColorString(zone.severity === 'high' ? '#ff746c' : '#ffe17c').withAlpha(0.92 * opacity);

  flightZonesDataSource.entities.add({
    id: reserveFlightZoneId(zone.id, usedIds),
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(flattenPoints(points)),
      height: Number(zone.floorMeters ?? 0),
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
      domain: 'flight',
      id: zone.id,
      name: zone.name,
      zoneType: zone.zoneType ?? 'gps',
      severity: zone.severity ?? 'medium',
      source: zone.source ?? 'GPSJam',
      status: zone.status ?? 'active',
      activeWindowUtc: buildZoneWindowLabel(zone),
      summary: zone.summary ?? '',
    },
  });
}

function syncFlightZoneVisibility() {
  if (flightZonesDataSource) flightZonesDataSource.show = enabled;
}

function renderFlightZones(payload) {
  noflyGpsPayloadCache = payload;
  if (!flightZonesDataSource) return;

  const nowMs = Date.now();
  const maxHeight = Number(payload?.maxFlightHeightMeters ?? NOFLY_GPS_DEFAULT_MAX_HEIGHT_M);
  const usedIds = new Set();
  flightZonesDataSource.entities.removeAll();

  if (flightZoneFilters.airspace) {
    for (const zone of payload?.flightRestrictions ?? []) {
      addFlightRestrictionZone(zone, nowMs, maxHeight, usedIds);
    }
  }
  if (flightZoneFilters.gps) {
    for (const zone of payload?.gpsInterference ?? []) {
      addGpsInterferenceZone(zone, nowMs, maxHeight, usedIds);
    }
  }

  syncFlightZoneVisibility();
}

function noflyGpsUrlForViewer(viewer) {
  if (!viewer) return NOFLY_GPS_URL;
  const bounds = getViewportBounds(viewer);
  if (!bounds) return NOFLY_GPS_URL;
  const boundsStr = [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat]
    .map(v => Number(v).toFixed(4))
    .join(',');
  return `${NOFLY_GPS_URL}?bounds=${encodeURIComponent(boundsStr)}`;
}

async function refreshFlightZones(viewer) {
  try {
    const response = await fetch(noflyGpsUrlForViewer(viewer));
    if (!response.ok) throw new Error(`nofly_gps ${response.status}`);
    const payload = await response.json();
    renderFlightZones(payload);
  } catch (error) {
    console.warn('[Flights] No-fly/GPS refresh failed:', error);
    if (noflyGpsPayloadCache) renderFlightZones(noflyGpsPayloadCache);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function initFlights(viewer) {
  console.info(`[Flights] Provider: ${ACTIVE_PROVIDER}${SERVER_HEAVY_MODE ? ' (server-heavy mode)' : ''}`);

  // Defer the first fetch until the camera finishes its opening flyTo — before
  // that, getViewportBounds() returns null and providers reject lat/0/lon/0.
  // We wait for the camera's moveEnd event (fires when flyTo completes), with a
  // 6 s safety timeout in case the event never fires (e.g. no animation).
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 6000);
    viewer.camera.moveEnd.addEventListener(function onMoveEnd() {
      viewer.camera.moveEnd.removeEventListener(onMoveEnd);
      clearTimeout(timeout);
      resolve();
    });
  });

  if (SERVER_HEAVY_MODE) {
    subscribeServerSnapshot('flights', {
      onData(payload) {
        if (!enabled) return;

        try {
          const aircraft = mapProxyAircraft(payload?.flights?.aircraft ?? []);
          renderAircraft(viewer, aircraft);

          if (!flightFeedHealthy) {
            publishSystemStatus('● FLIGHT FEED RECOVERED · SERVER SNAPSHOT', 'ok', 'flights:recovered:server-snapshot');
          } else if (!hasPublishedFlightOk) {
            publishSystemStatus('● FLIGHT FEED OK · SERVER SNAPSHOT', 'ok', 'flights:ok:server-snapshot');
            hasPublishedFlightOk = true;
          }
          flightFeedHealthy = true;
        } catch (err) {
          console.warn('[Flights] Server snapshot apply failed:', err.message);
        }
      },
      onError(err) {
        console.warn('[Flights] Server snapshot failed:', err?.message ?? 'unknown');
        publishSystemStatus(`⚠ FLIGHT FEED ERROR · SERVER SNAPSHOT · ${err?.message ?? 'request failed'}`, 'error', `flights:error:server-snapshot:${err?.message ?? 'unknown'}`);
        flightFeedHealthy = false;
      },
    });

    return {
      setEnabled(val) {
        enabled = val;
        setServerSnapshotLayerEnabled('flights', enabled && isAnyClassificationActive());
        entityMap.forEach((e, icaoHex) => {
          const state = trackStateMap.get(icaoHex);
          const aircraftClassification = state?.aircraftClassification ?? 'commercial';
          e.show = shouldShowFlight(aircraftClassification);
        });
        applyFlatIconVisibility();
      },
      setAircraftClassificationFilter(classification, filterEnabled) {
        const classKey = (classification ?? 'commercial').toLowerCase();
        if (classKey in aircraftClassificationFilters) {
          aircraftClassificationFilters[classKey] = filterEnabled;
          entityMap.forEach((e, icaoHex) => {
            const state = trackStateMap.get(icaoHex);
            const aircraftClassification = state?.aircraftClassification ?? 'commercial';
            e.show = shouldShowFlight(aircraftClassification);
          });
          applyFlatIconVisibility();
          // Enable or suspend proxy polling based on whether any classification is still active.
          setServerSnapshotLayerEnabled('flights', enabled && isAnyClassificationActive());
        }
      },
      get count()    { return entityMap.size; },
      get provider() { return ACTIVE_PROVIDER; },
    };
  }

  setInterval(() => { if (enabled && isAnyClassificationActive()) fetchAndRender(viewer); }, POLL_MS);

  window.addEventListener('shadowgrid:follow', () => {
    hideAllFlatIcons = true;
    applyFlatIconVisibility();
  });

  window.addEventListener('shadowgrid:unfollow', () => {
    hideAllFlatIcons = false;
    applyFlatIconVisibility();
  });

  return {
    setEnabled(val) {
      enabled = val;
      if (enabled && isAnyClassificationActive()) fetchAndRender(viewer);
      entityMap.forEach((e, icaoHex) => {
        const state = trackStateMap.get(icaoHex);
        const aircraftClassification = state?.aircraftClassification ?? 'commercial';
        e.show = shouldShowFlight(aircraftClassification);
      });
      applyFlatIconVisibility();
    },
    setAircraftClassificationFilter(classification, filterEnabled) {
      const classKey = (classification ?? 'commercial').toLowerCase();
      if (classKey in aircraftClassificationFilters) {
        aircraftClassificationFilters[classKey] = filterEnabled;
        // Update visibility of all entities
        entityMap.forEach((e, icaoHex) => {
          const state = trackStateMap.get(icaoHex);
          const aircraftClassification = state?.aircraftClassification ?? 'commercial';
          e.show = shouldShowFlight(aircraftClassification);
        });
        applyFlatIconVisibility();
        // Trigger an immediate fetch when re-enabling after all were off; suppress
        // the poll interval when all classifications are inactive to save API quota.
        if (enabled) {
          if (filterEnabled && isAnyClassificationActive()) fetchAndRender(viewer);
        }
      }
    },
    get count()    { return entityMap.size; },
    get provider() { return ACTIVE_PROVIDER; },
  };
}

/**
 * Switch an aircraft between normal flat SVG view and follow 3D-model view.
 * Called from HUD.js when follow starts/stops.
 */
export function setFollowMode(icaoHex, active) {
  const entity = entityMap.get(icaoHex.toLowerCase());
  if (!entity) return;

  if (active) {
    hideAllFlatIcons = true;
    // Derive color from stored properties so military/commercial/other colors match
    const classification = entity.properties?.classification?.getValue?.() ?? 'commercial';
    const color    = classificationColor(classification);
    const category = entity.properties?.category?.getValue?.() ?? '';
    const typecode = entity.properties?.typecode?.getValue?.() ?? '';
    const shape    = getShape({ category, typecode });
    
    // Get model URL: uses asset if available, falls back to procedural
    const modelUrl = getAircraftModelUrl(typecode, shape, color);
    
    // Determine if this is an asset model or procedural model
    const isAssetModel = modelUrl.startsWith('/src/assets/');
    
    const scale    = MODEL_SCALE[shape] ?? MODEL_SCALE.generic;
    const cesColor = Cesium.Color.fromCssColorString(color);

    // Create dynamic orientation property that continuously follows heading as aircraft updates
    entity.orientation = new Cesium.CallbackProperty(() => {
      const heading = entity.properties?.heading?.getValue?.() ?? 0;
      const pos     = entity.position?.getValue?.(Cesium.JulianDate.now());
      if (pos) {
        // Asset models need 90° offset to correct their axis orientation
        const headingOffset = isAssetModel ? 90 : 0;
        const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading + headingOffset), 0, 0);
        return Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
      }
      return Cesium.Quaternion.IDENTITY;
    }, false);

    // Attach the 3-D model and hide the flat SVG icon
    // Asset models: use original colors from the model (no tinting)
    // Procedural models: apply military/commercial/other classification colors
    const modelGraphicsProps = {
      uri:              new Cesium.ConstantProperty(modelUrl),
      scale:            new Cesium.ConstantProperty(scale),
      maximumScale:     new Cesium.ConstantProperty(scale),
      minimumPixelSize: new Cesium.ConstantProperty(12),
      shadows:          new Cesium.ConstantProperty(Cesium.ShadowMode.DISABLED),
      silhouetteColor:  new Cesium.ConstantProperty(Cesium.Color.BLACK),
      silhouetteSize:   new Cesium.ConstantProperty(1.0),
      show:             new Cesium.ConstantProperty(true),
    };
    
    // Only apply color tinting to procedural models (asset models keep their original colors)
    if (!isAssetModel) {
      modelGraphicsProps.color            = new Cesium.ConstantProperty(cesColor);
      modelGraphicsProps.colorBlendMode   = new Cesium.ConstantProperty(Cesium.ColorBlendMode.MIX);
      modelGraphicsProps.colorBlendAmount = new Cesium.ConstantProperty(0.5);
    }

    entity.model = new Cesium.ModelGraphics(modelGraphicsProps);
    
    if (entity.billboard) entity.billboard.show = new Cesium.ConstantProperty(false);
    if (entity.label) entity.label.show = new Cesium.ConstantProperty(false);
    applyFlatIconVisibility();

  } else {
    hideAllFlatIcons = false;
    // Restore SVG icon, hide model
    if (entity.billboard) entity.billboard.show = new Cesium.ConstantProperty(enabled);
    if (entity.label) entity.label.show = new Cesium.ConstantProperty(enabled);
    if (entity.model)     entity.model.show     = new Cesium.ConstantProperty(false);
    entity.orientation = undefined;
    applyFlatIconVisibility();
  }
}

// ── Viewport bounds ───────────────────────────────────────────────────────────

function getViewportBounds(viewer) {
  try {
    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rect) return null;
    const toDeg = Cesium.Math.toDegrees;
    return {
      minLon: toDeg(rect.west),
      minLat: toDeg(rect.south),
      maxLon: toDeg(rect.east),
      maxLat: toDeg(rect.north),
    };
  } catch { return null; }
}

// ── Fetch dispatch ────────────────────────────────────────────────────────────

async function fetchAndRender(viewer) {
  try {
    const bounds   = getViewportBounds(viewer);
    const aircraft = await fetchAircraft(bounds);
    renderAircraft(viewer, aircraft);

    if (!flightFeedHealthy) {
      publishSystemStatus(`● FLIGHT FEED RECOVERED · ${ACTIVE_PROVIDER.toUpperCase()}`, 'ok', `flights:recovered:${ACTIVE_PROVIDER}`);
    } else if (!hasPublishedFlightOk) {
      publishSystemStatus(`● FLIGHT FEED OK · ${ACTIVE_PROVIDER.toUpperCase()}`, 'ok', `flights:ok:${ACTIVE_PROVIDER}`);
      hasPublishedFlightOk = true;
    }
    flightFeedHealthy = true;
  } catch (err) {
    console.warn(`[Flights] Fetch failed (${ACTIVE_PROVIDER}):`, err.message);
    publishSystemStatus(`⚠ FLIGHT FEED ERROR · ${ACTIVE_PROVIDER.toUpperCase()} · ${err?.message ?? 'request failed'}`, 'error', `flights:error:${ACTIVE_PROVIDER}:${err?.message ?? 'unknown'}`);
    flightFeedHealthy = false;
  }
}

async function fetchAircraft(bounds) {
  switch (ACTIVE_PROVIDER) {
    case 'airplaneslive': {
      try {
        return await fetchReadsbLike(AIRPLANESLIVE_BASE_URL, bounds, 'airplanes.live');
      } catch (err) {
        console.warn('[Flights] airplanes.live unavailable, falling back to adsb.lol:', err.message);
        publishSystemStatus('⚠ AIRPLANES.LIVE UNAVAILABLE · USING ADSB.LOL FALLBACK', 'warn', 'flights:airplaneslive-fallback');
        return fetchReadsbLike(ADSBOOL_BASE_URL, bounds, 'adsb.lol');
      }
    }
    case 'adsbool':       return fetchReadsbLike(ADSBOOL_BASE_URL, bounds, 'adsb.lol');
    case 'opensky': return fetchOpenSky();
    case 'proxy':
    default:        return fetchProxy(bounds);
  }
}

function boundsToQueryCenter(bounds) {
  if (!bounds) return null;

  const minLon = Number(bounds.minLon);
  const minLat = Number(bounds.minLat);
  const maxLon = Number(bounds.maxLon);
  const maxLat = Number(bounds.maxLat);

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;

  let lonSpan = maxLon - minLon;
  if (lonSpan < 0) lonSpan += 360;
  const latSpan = Math.max(0, maxLat - minLat);

  let centerLon = minLon + lonSpan / 2;
  if (centerLon > 180) centerLon -= 360;
  const centerLat = minLat + latSpan / 2;

  // Approximate viewport diagonal and convert to nautical miles.
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.max(Math.cos(centerLat * Math.PI / 180), 0.1);
  const diagKm = Math.hypot(latSpan * kmPerDegLat, lonSpan * kmPerDegLon);
  const radiusNm = Math.min(250, Math.max(75, Math.round((diagKm / 1.852) * 0.6)));

  return {
    lat: centerLat,
    lon: centerLon,
    distNm: radiusNm,
  };
}

async function fetchReadsbLike(baseUrl, bounds, providerLabel) {
  const query = boundsToQueryCenter(bounds);
  // If bounds aren't available yet (camera still initialising), skip this cycle
  // rather than sending lat/0/lon/0 which most providers reject with 404.
  if (!query) return [];

  // Provider compatibility: some READSB-style APIs use /v2/lat/.../lon/.../dist/...
  // while others expose /v2/point/{lat}/{lon}/{dist}. Try both before failing.
  const candidateUrls = [
    `${baseUrl}/v2/lat/${query.lat.toFixed(4)}/lon/${query.lon.toFixed(4)}/dist/${query.distNm}`,
    `${baseUrl}/v2/point/${query.lat.toFixed(4)}/${query.lon.toFixed(4)}/${query.distNm}`,
  ];

  let data = null;
  let lastError = null;
  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        lastError = new Error(`${providerLabel} ${resp.status}`);
        continue;
      }
      data = await resp.json();
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!data) throw lastError ?? new Error(`${providerLabel} unavailable`);

  const aircraft = data.aircraft ?? data.ac ?? [];

  const numOr = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return aircraft
    .filter(a => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)))
    .map(a => {
      const onGround = a.alt_baro === 'ground' || a.gnd === true || a.on_ground === true;
      const altFt = onGround ? 0 : numOr(a.alt_baro ?? a.alt_geom, 0);
      return {
      id:       (a.hex ?? '').toLowerCase(),
      callsign: (a.flight ?? a.r ?? '').trim(),
      lat:      a.lat,
      lon:      a.lon,
      altFt,
      heading:  numOr(a.track ?? a.true_heading, 0),
      kts:      numOr(a.gs, 0),
      category: a.category ?? '',
      typecode: (a.t ?? a.type ?? '').toUpperCase(),
      squawk:   a.squawk ?? '',
      emergency: a.emergency ?? 'none',
      onGround,
      dbFlags:  a.dbFlags ?? 0,
      vert:     numOr(a.baro_rate ?? a.geom_rate, 0),
    };
    })
    .filter(a => a.id);
}

// ── Provider: local proxy ─────────────────────────────────────────────────────

async function fetchProxy(bounds) {
  let url = PROXY_URL;
  if (bounds) {
    const { minLon, minLat, maxLon, maxLat } = bounds;
    url += `?bounds=${minLon.toFixed(4)},${minLat.toFixed(4)},${maxLon.toFixed(4)},${maxLat.toFixed(4)}`;
  }
  if (SERVER_HEAVY_MODE) {
    url += bounds ? '&mode=heavy' : '?mode=heavy';
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Proxy ${resp.status} — is server/proxy.mjs running?`);
  const data = await resp.json();
  const aircraft = mapProxyAircraft(data.aircraft ?? []);
  console.info(`[Flights] ${aircraft.length} aircraft in viewport`);
  return aircraft;
}

function mapProxyAircraft(aircraft) {
  const numOr = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return aircraft
    .filter(a => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)))
    .map(a => {
      const onGround = a.alt_baro === 'ground' || a.gnd === true || a.on_ground === true;
      const altFt = onGround ? 0 : numOr(a.alt_baro ?? a.alt_geom, 0);
      return {
      id:       (a.hex ?? '').toLowerCase(),
      callsign: (a.flight ?? a.r ?? '').trim(),
      lat:      a.lat,
      lon:      a.lon,
      altFt,
      heading:  numOr(a.track ?? a.true_heading, 0),
      kts:      numOr(a.gs, 0),
      category: a.category ?? '',
      typecode: (a.t ?? a.type ?? '').toUpperCase(),
      squawk:   a.squawk ?? '',
      emergency: a.emergency ?? 'none',
      onGround,
      dbFlags:  a.dbFlags ?? 0,
      vert:     numOr(a.baro_rate ?? a.geom_rate, 0),
    };
    })
    .filter(a => a.id);
}

// ── Provider: OpenSky ─────────────────────────────────────────────────────────

async function fetchOpenSky() {
  const token   = await getOpenSkyToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  // Request extended state vectors so index 17 (emitter category) is present.
  const resp    = await fetch('/api/opensky/api/states/all?extended=1', { headers });
  if (!resp.ok) throw new Error(`OpenSky ${resp.status}`);
  const data = await resp.json();
  return (data.states ?? [])
    .filter(s => Number.isFinite(Number(s[5])) && Number.isFinite(Number(s[6])))
    .map(s => ({
      id:       s[0].trim(),
      callsign: (s[1] ?? '').trim(),
      lat:      s[6],
      lon:      s[5],
      altFt:    s[8] ? 0 : (s[7] ?? 3000) * 3.281,
      heading:  s[10] ?? 0,
      kts:      (s[9] ?? 0) * 1.944,
      category: Number.isFinite(Number(s[17])) ? Number(s[17]) : null,
      squawk:   s[14] ?? '',
      emergency: ['7500', '7600', '7700'].includes(String(s[14] ?? '').trim()) ? String(s[14]).trim() : 'none',
      onGround: s[8] === true,
      vert:     (s[11] ?? 0) * 196.85,  // m/s → ft/min
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
        grant_type: 'client_credentials',
        client_id:  OPENSKY_CLIENT_ID,
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

function updateTrackState(id, a) {
  const shape = getShape(a);  // Get the aircraft shape/type
  const classification = classifyAircraft(a);  // Get military/commercial/other
  trackStateMap.set(id, {
    aircraftType: shape,  // Store aircraft type for filtering
    aircraftClassification: classification,  // Store classification for filtering
    latRad: Cesium.Math.toRadians(a.lat),
    lonRad: Cesium.Math.toRadians(a.lon),
    altM: Math.max(0, a.altFt * 0.3048),
    headingRad: Cesium.Math.toRadians(a.heading ?? 0),
    speedMps: Math.max(0, (a.kts ?? 0) * KTS_TO_MPS),
    vertMps: (a.vert ?? 0) * FTMIN_TO_MPS,
    baseTimeSec: Date.now() / 1000,
  });
}

function predictTrackState(state) {
  const nowSec = Date.now() / 1000;
  const dt = Math.min(MAX_PREDICT_SECONDS, Math.max(0, nowSec - state.baseTimeSec));

  const dist = state.speedMps * dt;
  if (dist < 0.01) {
    return {
      latRad: state.latRad,
      lonRad: state.lonRad,
      altM: Math.max(0, state.altM + state.vertMps * dt),
    };
  }

  const ad = dist / EARTH_RADIUS_M;
  const sinLat1 = Math.sin(state.latRad);
  const cosLat1 = Math.cos(state.latRad);
  const sinAd = Math.sin(ad);
  const cosAd = Math.cos(ad);
  const sinBrg = Math.sin(state.headingRad);
  const cosBrg = Math.cos(state.headingRad);

  const latRad = Math.asin(sinLat1 * cosAd + cosLat1 * sinAd * cosBrg);
  const lonRad = state.lonRad + Math.atan2(
    sinBrg * sinAd * cosLat1,
    cosAd - sinLat1 * Math.sin(latRad)
  );

  return {
    latRad,
    lonRad: Cesium.Math.zeroToTwoPi(lonRad),
    altM: Math.max(0, state.altM + state.vertMps * dt),
  };
}

function getTrackPositionProperty(id) {
  if (trackPosPropMap.has(id)) return trackPosPropMap.get(id);
  const scratch = new Cesium.Cartesian3();
  const prop = new Cesium.CallbackPositionProperty((time, result) => {
    const state = trackStateMap.get(id);
    if (!state) return result ?? scratch;
    const p = predictTrackState(state);
    return Cesium.Cartesian3.fromRadians(p.lonRad, p.latRad, p.altM, undefined, result ?? scratch);
  }, false);
  trackPosPropMap.set(id, prop);
  return prop;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderAircraft(viewer, aircraft) {
  const setProp = (bag, key, value) => {
    const p = bag?.[key];
    if (p?.setValue) p.setValue(value);
    else if (bag) bag[key] = value;
  };

  const seen = new Set();

  for (const a of aircraft) {
    if (!a.id) continue;
    seen.add(a.id);
    updateTrackState(a.id, a);

    const altMetres = a.altFt * 0.3048;
    const color     = aircraftColor(a);
    const shape     = getShape(a);
    if (!SHAPES[shape]) {
      console.warn('[flights.js] Unknown shape for aircraft:', {
        id: a.id,
        typecode: a.typecode,
        typeDescription: a.typeDescription,
        category: a.category,
        resolvedShape: shape
      });
    }
    const classification = classifyAircraft(a);  // Get classification for visibility
    const icon      = buildSvgUri(shape, color);
    const iconSizePx = ICON_SIZE_PX[shape] ?? ICON_SIZE_PX.generic;
    const cesColor  = Cesium.Color.fromCssColorString(color);

    if (entityMap.has(a.id)) {
      const entity = entityMap.get(a.id);
      entity.position = getTrackPositionProperty(a.id);
      // Re-check visibility on every update to respect current filters
      entity.show = shouldShowFlight(classification);
      if (entity.billboard) {
        // Check if this aircraft is currently selected (has glow enabled)
        const useGlow = selectedFlightId === a.id;
        const iconToUse = useGlow ? buildGlowSvgUri(shape, color) : icon;
        entity.billboard.image    = new Cesium.ConstantProperty(iconToUse);
        entity.billboard.width    = new Cesium.ConstantProperty(iconSizePx);
        entity.billboard.height   = new Cesium.ConstantProperty(iconSizePx);
        entity.billboard.rotation = new Cesium.ConstantProperty(iconRotationFromHeading(a.heading));
      }
      // Update stored props for HUD
      if (entity.properties) {
        setProp(entity.properties, 'callsign', a.callsign);
        setProp(entity.properties, 'altFt', a.altFt);
        setProp(entity.properties, 'kts', a.kts);
        setProp(entity.properties, 'heading', a.heading);
        setProp(entity.properties, 'squawk', a.squawk);
        setProp(entity.properties, 'emergency', a.emergency ?? 'none');
        setProp(entity.properties, 'onGround', !!a.onGround);
        setProp(entity.properties, 'dbFlags', a.dbFlags);
        setProp(entity.properties, 'vert', a.vert);
        setProp(entity.properties, 'category', a.category);
        // Only overwrite typecode from the feed if the feed actually has one.
        // Preserve any HUD-enriched value when the provider (e.g. OpenSky) sends nothing.
        const effectiveTypecode = a.typecode || enrichedTypecodeMap.get(a.id) || '';
        setProp(entity.properties, 'typecode', effectiveTypecode);
        setProp(entity.properties, 'classification', classification);
      }
    } else {
      const entity = viewer.entities.add({
        id:       `flight-${a.id}`,
        position: getTrackPositionProperty(a.id),
        show:     shouldShowFlight(classification),
        billboard: {
          image:                    icon,
          width:                    iconSizePx,
          height:                   iconSizePx,
          rotation:                 iconRotationFromHeading(a.heading),
          alignedAxis:              Cesium.Cartesian3.UNIT_Z,
          scaleByDistance:          new Cesium.NearFarScalar(1e3, 1.6, 8e6, 0.65),
          color:                    Cesium.Color.WHITE,
          disableDepthTestDistance: 5e6,
          show:                     shouldShowFlight(classification) && !hideAllFlatIcons,
        },
        label: {
          text:                     a.callsign || a.id.toUpperCase(),
          font:                     '10px "Share Tech Mono", monospace',
          fillColor:                cesColor,
          outlineColor:             Cesium.Color.BLACK,
          outlineWidth:             2,
          style:                    Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:              new Cesium.Cartesian2(16, -10),
          scaleByDistance:          new Cesium.NearFarScalar(1e3, 1.0, 3e6, 0),
          translucencyByDistance:   new Cesium.NearFarScalar(1e3, 1.0, 2e6, 0),
          disableDepthTestDistance: 5e6,
          show:                     shouldShowFlight(classification) && !hideAllFlatIcons,
        },
        properties: {
          type:           'flight',
          icao:           a.id,
          callsign:       a.callsign,
          altFt:          a.altFt,
          kts:            a.kts,
          heading:        a.heading,
          squawk:         a.squawk,
          emergency:      a.emergency ?? 'none',
          onGround:       !!a.onGround,
          dbFlags:        a.dbFlags,
          vert:           a.vert,
          category:       a.category,
          typecode:       a.typecode || enrichedTypecodeMap.get(a.id) || '',
          provider:       ACTIVE_PROVIDER,
          classification: classification,
        },
      });
      entityMap.set(a.id, entity);
    }
  }

  // Remove aircraft that left viewport
  for (const [id, entity] of entityMap) {
    if (!seen.has(id)) {
      viewer.entities.remove(entity);
      entityMap.delete(id);
      trackStateMap.delete(id);
      trackPosPropMap.delete(id);
    }
  }

  console.info(`[Flights] Rendering ${entityMap.size} aircraft`);
}

// ── Glow effect for selected flight ───────────────────────────────────────────

let selectedFlightId = null;
const glowSvgCache = new Map();

function getContrastingGlowColor(fillColor) {
  // Return a contrasting color for the glow based on the fill color
  const colorMap = {
    '#f44336': '#00ff88', // military red → bright green
    '#00e676': '#ff8800', // commercial green → orange
    '#ffa726': '#00b8ff', // other orange → cyan
  };
  return colorMap[fillColor] || '#00ff88'; // default to bright green
}

function buildGlowSvgUri(shape, color) {
  const key = `${shape}:${color}:glow`;
  if (glowSvgCache.has(key)) return glowSvgCache.get(key);

  const glowCol  = getContrastingGlowColor(color);
  const shapeDef = SHAPES[shape] ?? SHAPES.unknown;
  const vb       = shapeDef.viewBox ?? '0 0 32 32';
  // Use ICON_SIZE_PX for per-shape icon size, fallback to 32 if not found
  const iconSize = ICON_SIZE_PX[shape] || 32;
  const w = iconSize, h = iconSize;

  // Determine viewBox centre for pulsing ring positioning
  const vbParts = vb.split(/[\s,]+/).map(Number);
  const cx = (vbParts[0] ?? 0) + (vbParts[2] ?? 32) / 2;
  const cy = (vbParts[1] ?? 0) + (vbParts[3] ?? 32) / 2;
  const r1 = Math.min(vbParts[2] ?? 32, vbParts[3] ?? 32) * 0.4;
  const r2 = r1 * 0.88;

  const xform    = shapeDef.transform ? ` transform="${shapeDef.transform}"` : '';
  const fillInner = shapeToInnerSvg(shapeDef, color, glowCol);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">
  <defs>
    <filter id="glow-filter" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="${glowCol}" stroke-width="2" opacity="0.6">
    <animate attributeName="r" values="${r1};${r1*1.38};${r1}" dur="1.5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.5s" repeatCount="indefinite"/>
  </circle>
  <circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="${glowCol}" stroke-width="1.5" opacity="0.4">
    <animate attributeName="r" values="${r2};${r2*1.43};${r2}" dur="2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.6;0.15;0.6" dur="2s" repeatCount="indefinite"/>
  </circle>
  <g${xform} stroke-linejoin="round" filter="url(#glow-filter)">${fillInner}</g>
</svg>`;

  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  glowSvgCache.set(key, uri);
  return uri;
}

export function setFlightGlow(icaoHex, active) {
  const id = icaoHex.toLowerCase();
  const entity = entityMap.get(id);
  if (!entity) return;

  if (active) {
    selectedFlightId = id;
    // Get current color and shape from stored properties
    const classification = entity.properties?.classification?.getValue?.() ?? 'commercial';
    const color    = classificationColor(classification);
    const category = entity.properties?.category?.getValue?.() ?? '';
    const typecode = entity.properties?.typecode?.getValue?.() ?? '';
    const shape    = getShape({ category, typecode });

    // Build glowing SVG and apply it
    const glowIcon = buildGlowSvgUri(shape, color);
    if (entity.billboard) {
      entity.billboard.image = new Cesium.ConstantProperty(glowIcon);
    }
  } else {
    if (selectedFlightId === id) selectedFlightId = null;
    // Restore normal icon
    const classification = entity.properties?.classification?.getValue?.() ?? 'commercial';
    const color    = classificationColor(classification);
    const category = entity.properties?.category?.getValue?.() ?? '';
    const typecode = entity.properties?.typecode?.getValue?.() ?? '';
    const shape    = getShape({ category, typecode });

    const normalIcon = buildSvgUri(shape, color);
    if (entity.billboard) {
      entity.billboard.image = new Cesium.ConstantProperty(normalIcon);
    }
  }
}
