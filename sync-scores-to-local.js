#!/usr/bin/env node
// sync-scores-to-local.js
// Pulls actual scores + results from Railway and updates local SQLite DB.

const https    = require("https");
const Database = require("better-sqlite3");
const path     = require("path");

const RAILWAY_URL = "https://pili1218mlb2026-production.up.railway.app/api/export-all";
const DB_PATH     = path.join(__dirname, "predictions.db");

console.log("[sync-scores] Fetching from Railway...");

https.get(RAILWAY_URL, (res) => {
  let body = "";
  res.on("data", (c) => { body += c; });
  res.on("end", () => {
    const parsed = JSON.parse(body);
    if (!parsed.success || !Array.isArray(parsed.data)) {
      console.error("[sync-scores] Bad response:", body.slice(0, 200));
      process.exit(1);
    }

    const db = new Database(DB_PATH);
    const update = db.prepare(`
      UPDATE predictions SET
        actual_home_score = @actual_home_score,
        actual_away_score = @actual_away_score,
        actual_total      = @actual_total,
        actual_winner     = @actual_winner,
        ml_result         = @ml_result,
        ou_result         = @ou_result,
        ml_correct        = @ml_correct,
        ou_correct        = @ou_correct
      WHERE id = @id
    `);

    const updateMany = db.transaction((rows) => {
      let updated = 0;
      for (const r of rows) {
        const result = update.run({
          id:                r.id,
          actual_home_score: r.actual_home_score,
          actual_away_score: r.actual_away_score,
          actual_total:      r.actual_total,
          actual_winner:     r.actual_winner,
          ml_result:         r.ml_result,
          ou_result:         r.ou_result,
          ml_correct:        r.ml_correct,
          ou_correct:        r.ou_correct,
        });
        if (result.changes > 0) updated++;
      }
      return updated;
    });

    const count = updateMany(parsed.data);
    console.log(`[sync-scores] Done — ${count} rows updated in local DB.`);
    db.close();
  });
}).on("error", (e) => {
  console.error("[sync-scores] Fetch error:", e.message);
  process.exit(1);
});
