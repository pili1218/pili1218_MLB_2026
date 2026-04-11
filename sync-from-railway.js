#!/usr/bin/env node
// sync-from-railway.js
// Run BEFORE every git commit. Fetches all prediction rows from Railway
// and overwrites predictions-export.json so the seed file is never stale.
//
// Usage:  node sync-from-railway.js
//    OR:  npm run sync-railway

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const RAILWAY_URL = "https://pili1218mlb2026-production.up.railway.app/api/export-all";
const EXPORT_PATH = path.join(__dirname, "predictions-export.json");

console.log("[sync] Fetching from Railway:", RAILWAY_URL);

https.get(RAILWAY_URL, (res) => {
  let body = "";
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    try {
      const parsed = JSON.parse(body);
      if (!parsed.success || !Array.isArray(parsed.data)) {
        console.error("[sync] ERROR: Unexpected response shape:", body.slice(0, 200));
        process.exit(1);
      }
      const rows = parsed.data;
      fs.writeFileSync(EXPORT_PATH, JSON.stringify(rows, null, 2));
      const newest = rows[rows.length - 1];
      console.log(`[sync] SUCCESS: ${rows.length} rows written to predictions-export.json`);
      console.log(`[sync] Newest entry: id=${newest?.id}, saved_at=${newest?.saved_at}`);
      console.log("[sync] predictions-export.json is now safe to commit.");
    } catch (e) {
      console.error("[sync] ERROR parsing response:", e.message);
      process.exit(1);
    }
  });
}).on("error", (e) => {
  console.error("[sync] ERROR fetching Railway:", e.message);
  process.exit(1);
});
