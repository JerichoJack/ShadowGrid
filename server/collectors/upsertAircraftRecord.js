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
  if (fs.existsSync(DB_PATH)) {
    const csv = fs.readFileSync(DB_PATH, 'utf8');
    rows = csvParse(csv, { columns: true, skip_empty_lines: true });
  }
  // Find existing row for this icao24
  const idx = rows.findIndex(r => (r.icao24 || r.ICAO24 || '').toLowerCase() === info.icao24.toLowerCase());
  if (idx !== -1) {
    // Update only provided fields, preserve others
    const updated = { ...rows[idx] };
    for (const k of Object.keys(info)) {
      if (headers.includes(k)) updated[k] = info[k] || '';
    }
    rows[idx] = updated;
  } else {
    // New row: fill all fields with info or 'unknown'
    const newRow = {};
    for (const h of headers) {
      newRow[h] = (info[h] !== undefined && info[h] !== null && info[h] !== '') ? info[h] : 'unknown';
    }
    rows.push(newRow);
  }
  // Write back to CSV
  const csvOut = csvStringify(rows, { header: true, columns: headers });
  fs.writeFileSync(DB_PATH, csvOut, 'utf8');
}
