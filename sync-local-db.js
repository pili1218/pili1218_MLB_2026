#!/usr/bin/env node
// sync-local-db.js
// Fetches all rows from Railway and upserts them into the LOCAL predictions.db.
// Run this whenever you want the local server to reflect Railway's latest data.
//
// Usage:  node sync-local-db.js
//    OR:  npm run sync-local

const https    = require("https");
const fs       = require("fs");
const path     = require("path");
const Database = require("better-sqlite3");

const RAILWAY_URL = "https://pili1218mlb2026-production.up.railway.app/api/export-all";
const EXPORT_PATH = path.join(__dirname, "predictions-export.json");
const DB_PATH     = path.join(__dirname, "predictions.db");

console.log("[sync-local] Fetching from Railway:", RAILWAY_URL);

https.get(RAILWAY_URL, (res) => {
  let body = "";
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    try {
      const parsed = JSON.parse(body);
      if (!parsed.success || !Array.isArray(parsed.data)) {
        console.error("[sync-local] ERROR: Unexpected response shape:", body.slice(0, 200));
        process.exit(1);
      }

      const rows = parsed.data;

      // 1. Update predictions-export.json (keeps commit safety intact)
      fs.writeFileSync(EXPORT_PATH, JSON.stringify(rows, null, 2));
      console.log(`[sync-local] predictions-export.json updated (${rows.length} rows)`);

      // 2. Upsert into local predictions.db
      const db = new Database(DB_PATH);
      console.log(`[sync-local] Opened local DB: ${DB_PATH}`);

      // Upsert: insert new rows; for existing rows update only result fields
      // (actual scores, ml_correct, ou_correct, ml_result, ou_result, notes)
      // so local-only edits to non-result fields are preserved.
      const upsert = db.prepare(`
        INSERT INTO predictions (
          id, saved_at, game_date, season_type, home_team, away_team,
          home_starter, away_starter, home_win_pct, away_win_pct,
          ou_line, ou_prediction, ou_confidence, ou_over_pct, confidence_score,
          gvi, home_tms, away_tms, home_pms, away_pms,
          home_pvs, away_pvs, home_red, away_red, pdcf_active,
          active_flags, active_overrides, betting_recommendation,
          key_driver, reasoning, export_string, full_prediction,
          actual_winner, actual_home_score, actual_away_score, actual_total,
          ml_result, ou_result, ml_correct, ou_correct, notes
        ) VALUES (
          @id, @saved_at, @game_date, @season_type, @home_team, @away_team,
          @home_starter, @away_starter, @home_win_pct, @away_win_pct,
          @ou_line, @ou_prediction, @ou_confidence, @ou_over_pct, @confidence_score,
          @gvi, @home_tms, @away_tms, @home_pms, @away_pms,
          @home_pvs, @away_pvs, @home_red, @away_red, @pdcf_active,
          @active_flags, @active_overrides, @betting_recommendation,
          @key_driver, @reasoning, @export_string, @full_prediction,
          @actual_winner, @actual_home_score, @actual_away_score, @actual_total,
          @ml_result, @ou_result, @ml_correct, @ou_correct, @notes
        )
        ON CONFLICT(id) DO UPDATE SET
          actual_winner     = excluded.actual_winner,
          actual_home_score = excluded.actual_home_score,
          actual_away_score = excluded.actual_away_score,
          actual_total      = excluded.actual_total,
          ml_result         = excluded.ml_result,
          ou_result         = excluded.ou_result,
          ml_correct        = excluded.ml_correct,
          ou_correct        = excluded.ou_correct,
          notes             = excluded.notes
      `);

      const syncAll = db.transaction((records) => {
        let inserted = 0, updated = 0;
        for (const r of records) {
          const before = db.prepare("SELECT id FROM predictions WHERE id = ?").get(r.id);
          upsert.run(r);
          if (before) updated++;
          else inserted++;
        }
        return { inserted, updated };
      });

      const { inserted, updated } = syncAll(rows);
      db.close();

      const newest = [...rows].sort((a, b) => (b.id - a.id))[0];
      console.log(`[sync-local] SUCCESS: ${inserted} new rows inserted, ${updated} rows checked for result updates`);
      console.log(`[sync-local] Total Railway rows: ${rows.length} | Newest: id=${newest?.id}, saved_at=${newest?.saved_at}`);
      console.log("[sync-local] Local server will reflect Railway data on next page load.");
    } catch (e) {
      console.error("[sync-local] ERROR:", e.message);
      process.exit(1);
    }
  });
}).on("error", (e) => {
  console.error("[sync-local] ERROR fetching Railway:", e.message);
  process.exit(1);
});
