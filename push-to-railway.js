#!/usr/bin/env node
// push-to-railway.js — push local predictions that are missing from Railway

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
        catch { resolve({ raw: d }); }
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
        catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('[push] Fetching Railway IDs…');
  const railwayData = await httpsGet(`${RAILWAY}/api/export-all`);
  const railwayIds = new Set(railwayData.data.map(r => r.id));
  console.log(`[push] Railway has ${railwayIds.size} predictions (newest id=${Math.max(...railwayIds)})`);

  const db = new Database('./predictions.db');
  const localRows = db.prepare('SELECT * FROM predictions ORDER BY id ASC').all();
  db.close();
  console.log(`[push] Local has ${localRows.length} predictions`);

  const missing = localRows.filter(r => !railwayIds.has(r.id));
  console.log(`[push] ${missing.length} predictions to push to Railway`);

  if (missing.length === 0) {
    console.log('[push] Railway is already up to date.');
    return;
  }

  let ok = 0, fail = 0;
  for (const row of missing) {
    try {
      const res = await httpsPost(`${RAILWAY}/api/import-manual`, { json: row });
      if (res.success || res.id) {
        ok++;
        process.stdout.write(`\r[push] ${ok}/${missing.length} pushed (id=${row.id})   `);
      } else {
        fail++;
        console.log(`\n[push] FAIL id=${row.id}:`, JSON.stringify(res));
      }
    } catch (e) {
      fail++;
      console.log(`\n[push] ERROR id=${row.id}:`, e.message);
    }
  }

  console.log(`\n[push] Done — ${ok} pushed, ${fail} failed`);

  // Verify
  const verify = await httpsGet(`${RAILWAY}/api/export-all`);
  console.log(`[push] Railway now has ${verify.count} predictions`);
}

main().catch(e => { console.error('[push] Fatal:', e.message); process.exit(1); });
