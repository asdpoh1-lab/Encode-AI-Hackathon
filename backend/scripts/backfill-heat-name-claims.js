#!/usr/bin/env node
/**
 * One-time: populate heat_name_claims from existing human runs (pre-claims deployments).
 * Safe to run multiple times (INSERT OR IGNORE).
 *
 * Usage (from repo root): node backend/scripts/backfill-heat-name-claims.js
 */
const path = require('path');
const { initDb } = require(path.join(__dirname, '..', 'db'));
const { normalizeAgentNameForClaim } = require(path.join(__dirname, '..', 'submitValidation'));

const db = initDb();
const insert = db.prepare(
  'INSERT OR IGNORE INTO heat_name_claims (heat_id, normalized_name) VALUES (?, ?)'
);

const rows = db
  .prepare(
    `SELECT DISTINCT r.heat_id AS heat_id, a.name AS name
     FROM runs r
     JOIN agents a ON a.id = r.agent_id
     WHERE r.heat_id IS NOT NULL AND (a.is_benchmark IS NULL OR a.is_benchmark = 0)`
  )
  .all();

let n = 0;
for (const row of rows) {
  const norm = normalizeAgentNameForClaim(row.name);
  if (!norm) continue;
  const info = insert.run(row.heat_id, norm);
  if (info.changes > 0) n += 1;
}
console.log(`heat_name_claims: attempted ${rows.length} distinct (heat, name), inserted ${n} new row(s).`);
