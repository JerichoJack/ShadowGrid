// This script appends or updates aircraft info in aircraftDatabase.csv
// Usage: Call from server or via an API endpoint when new HUD info is available

import fs from 'fs';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../../public/aircraft-database-files/aircraftDatabase-New.csv');

/**
 * Upsert an aircraft record in the CSV database.
 * @param {Object} info - { icao24, registration, typecode, manufacturer, model, operator, country }
 */
export function upsertAircraftRecord(info) {
  if (!info.icao24) throw new Error('icao24 is required');
  let rows = [];
  // Use the full field list from the Python builder for consistency
  const headers = [
    'icao24','registration','manufacturericao','manufacturername','model','typecode',
    'serialnumber','linenumber','icaoaircrafttype','operator','operatorcallsign',
    'operatoricao','operatoriata','owner','testreg','registered','reguntil',
    'status','built','firstflightdate','seatconfiguration','engines','modes',
    'adsb','acars','notes','categoryDescription','firstseen','lastseen'
  ];

  // --- Normalization: only allow known fields, fill missing with '' ---
  const normalized = {};
  for (const h of headers) {
    normalized[h] = (info[h] !== undefined && info[h] !== null) ? info[h] : '';
  }
  // Remove any extraneous fields
  // (not strictly necessary, but ensures only unified schema is stored)

  if (fs.existsSync(DB_PATH)) {
    const csv = fs.readFileSync(DB_PATH, 'utf8');
    rows = csvParse(csv, { columns: true, skip_empty_lines: true });
  }
  // Find existing row for this icao24
  const idx = rows.findIndex(r => (r.icao24 || r.ICAO24 || '').toLowerCase() === normalized.icao24.toLowerCase());
  if (idx !== -1) {
    // Update only provided fields, preserve others
    const updated = { ...rows[idx] };
    for (const h of headers) {
      if (Object.prototype.hasOwnProperty.call(info, h) && info[h] !== undefined && info[h] !== null) {
        updated[h] = info[h];
      }
    }
    rows[idx] = updated;
  } else {
    // New row: fill all fields with normalized info
    rows.push({ ...normalized });
  }
  // Write back to CSV
  const csvOut = csvStringify(rows, { header: true, columns: headers });
  fs.writeFileSync(DB_PATH, csvOut, 'utf8');
}
