#!/usr/bin/env node
// push-to-railway.js
// Pushes all local predictions.db rows to Railway via /api/import.
// INSERT OR IGNORE — safe to run multiple times; only new rows are inserted.
//
// Usage:  node push-to-railway.js
//    OR:  npm run push-railway

const https    = require("https");
const Database = require("better-sqlite3");
const path     = require("path");
require("dotenv").config();

const RAILWAY_URL = "https://pili1218mlb2026-production.up.railway.app/api/import";
const DB_PATH     = path.join(__dirname, "predictions.db");
const SECRET      = process.env.IMPORT_SECRET || "";

const db   = new Database(DB_PATH);
const rows = db.prepare("SELECT * FROM predictions ORDER BY id ASC").all();
db.close();

console.log(`[push] Local DB: ${rows.length} rows — sending to Railway...`);

const body    = JSON.stringify({ rows });
const url     = new URL(RAILWAY_URL);
const options = {
  hostname: url.hostname,
  path:     url.pathname,
  method:   "POST",
  headers: {
    "Content-Type":     "application/json",
    "Content-Length":   Buffer.byteLength(body),
    "x-import-secret":  SECRET,
  },
};

const req = https.request(options, (res) => {
  let data = "";
  res.on("data", chunk => { data += chunk; });
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      if (json.success) {
        console.log(`[push] SUCCESS: ${json.inserted} new rows inserted on Railway`);
        console.log(`[push] ${json.total} sent total, ${json.total - json.inserted} already existed`);
      } else {
        console.error("[push] ERROR from Railway:", json.error || data);
        process.exit(1);
      }
    } catch (e) {
      console.error("[push] ERROR parsing response:", e.message, data.slice(0, 300));
      process.exit(1);
    }
  });
});

req.on("error", e => { console.error("[push] ERROR:", e.message); process.exit(1); });
req.write(body);
req.end();
