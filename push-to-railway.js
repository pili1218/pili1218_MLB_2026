#!/usr/bin/env node
// push-to-railway.js — batch push all local predictions to Railway /api/import

const Database = require('better-sqlite3');
const https = require('https');

const RAILWAY = 'https://pili1218mlb2026-production.up.railway.app';

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ raw: d.slice(0, 200) }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error('Invalid JSON: ' + d.slice(0, 100))); }
      });
    }).on('error', reject);
  });
}

async function main() {
  // Read local DB
  const db = new Database('./predictions.db');
  const localRows = db.prepare('SELECT * FROM predictions ORDER BY id ASC').all();
  db.close();
  console.log(`[push] Local DB: ${localRows.length} predictions`);

  // Check Railway current state
  const stats = await httpsGet(`${RAILWAY}/api/stats`);
  console.log(`[push] Railway current: ${stats.total} predictions`);

  // Send in batches of 50
  const BATCH = 50;
  let totalInserted = 0;

  for (let i = 0; i < localRows.length; i += BATCH) {
    const batch = localRows.slice(i, i + BATCH);
    const res = await httpsPost(`${RAILWAY}/api/import`, { rows: batch });
    if (res.inserted !== undefined) {
      totalInserted += res.inserted;
      console.log(`[push] Batch ${Math.floor(i/BATCH)+1}: inserted ${res.inserted}/${batch.length} (total so far: ${totalInserted})`);
    } else {
      console.log(`[push] Batch ${Math.floor(i/BATCH)+1} response:`, JSON.stringify(res).slice(0, 150));
    }
  }

  // Verify final count
  const verify = await httpsGet(`${RAILWAY}/api/stats`);
  console.log(`\n[push] ✅ Done — Railway now has ${verify.total} predictions (ML: ${verify.ml_accuracy}%)`);
}

main().catch(e => { console.error('[push] Fatal:', e.message); process.exit(1); });
