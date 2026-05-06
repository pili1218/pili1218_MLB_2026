require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database Setup ───────────────────────────────────────────────────────────
// Use Railway persistent volume if mounted, otherwise fallback to local
const dbPath = process.env.DB_PATH
  ? process.env.DB_PATH
  : process.env.VERCEL
    ? "/tmp/predictions.db"
    : path.join(__dirname, "predictions.db");
const db = new Database(dbPath);
console.log(`[DB] Using database at: ${dbPath}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS predictions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_at    TEXT    NOT NULL,
    game_date   TEXT,
    season_type TEXT,
    home_team   TEXT,
    away_team   TEXT,
    home_starter TEXT,
    away_starter TEXT,
    home_win_pct INTEGER,
    away_win_pct INTEGER,
    ou_line      TEXT,
    ou_prediction TEXT,
    ou_confidence TEXT,
    ou_over_pct  INTEGER,
    confidence_score INTEGER,
    gvi          INTEGER,
    home_tms     REAL,
    away_tms     REAL,
    home_pms     INTEGER,
    away_pms     INTEGER,
    home_pvs     REAL,
    away_pvs     REAL,
    home_red     REAL,
    away_red     REAL,
    pdcf_active  INTEGER,
    active_flags TEXT,
    active_overrides TEXT,
    betting_recommendation TEXT,
    key_driver   TEXT,
    reasoning    TEXT,
    export_string TEXT,
    full_prediction TEXT,
    -- Actual result columns (filled in after game)
    actual_winner     TEXT,
    actual_home_score INTEGER,
    actual_away_score INTEGER,
    actual_total      REAL,
    ml_result         TEXT,
    ou_result         TEXT,
    -- Regression columns (auto-computed on save)
    ml_correct        INTEGER,
    ou_correct        INTEGER,
    notes             TEXT
  );
`);

// ─── Auto-seed from bundled export on first run (restores data after Railway redeploy) ──
(function seedIfEmpty() {
  try {
    const count = db.prepare("SELECT COUNT(*) as n FROM predictions").get().n;
    if (count > 0) return;
    const seedPath = path.join(__dirname, "predictions-export.json");
    if (!require("fs").existsSync(seedPath)) return;
    const rows = JSON.parse(require("fs").readFileSync(seedPath, "utf8"));
    const seedStmt = db.prepare(`
      INSERT OR IGNORE INTO predictions (
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
    `);
    const seedAll = db.transaction((records) => {
      for (const r of records) seedStmt.run(r);
    });
    seedAll(rows);
    const newest = rows.reduce((a, b) => (a.saved_at > b.saved_at ? a : b), rows[0]);
    console.log(`[DB] Seeded ${rows.length} records from predictions-export.json (newest: id=${newest?.id} saved_at=${newest?.saved_at})`);
  } catch (e) {
    console.warn("[DB] Auto-seed skipped:", e.message);
  }
})();

const insertPrediction = db.prepare(`
  INSERT INTO predictions (
    saved_at, game_date, season_type, home_team, away_team,
    home_starter, away_starter, home_win_pct, away_win_pct,
    ou_line, ou_prediction, ou_confidence, ou_over_pct, confidence_score,
    gvi, home_tms, away_tms, home_pms, away_pms,
    home_pvs, away_pvs, home_red, away_red, pdcf_active,
    active_flags, active_overrides, betting_recommendation,
    key_driver, reasoning, export_string, full_prediction
  ) VALUES (
    @saved_at, @game_date, @season_type, @home_team, @away_team,
    @home_starter, @away_starter, @home_win_pct, @away_win_pct,
    @ou_line, @ou_prediction, @ou_confidence, @ou_over_pct, @confidence_score,
    @gvi, @home_tms, @away_tms, @home_pms, @away_pms,
    @home_pvs, @away_pvs, @home_red, @away_red, @pdcf_active,
    @active_flags, @active_overrides, @betting_recommendation,
    @key_driver, @reasoning, @export_string, @full_prediction
  )
`);

const updateActualResult = db.prepare(`
  UPDATE predictions SET
    actual_winner     = @actual_winner,
    actual_home_score = @actual_home_score,
    actual_away_score = @actual_away_score,
    actual_total      = @actual_total,
    ml_result         = @ml_result,
    ou_result         = @ou_result,
    ml_correct        = @ml_correct,
    ou_correct        = @ou_correct,
    notes             = @notes
  WHERE id = @id
`);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Store uploads in memory (buffer)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JSON_TEMPLATE = `{
  "game_date": "YYYY-MM-DD",
  "game_time": "HH:MM TZ",
  "venue": "Stadium Name, City, State",
  "home_team": "Team Name",
  "away_team": "Team Name",
  "weather": {
    "condition": "Description",
    "temperature": "XX°F",
    "wind_speed": "X mph Direction"
  },
  "betting": {
    "line": "X.X",
    "over_under": "X.X"
  },
  "starters": {
    "home": {
      "name": "Pitcher Name",
      "handedness": "Left-handed or Right-handed",
      "era": "X.XX",
      "whip": "X.XX",
      "win_loss": "XX-XX",
      "batting_avg_against": ".XXX",
      "innings_pitched": "XXX.X",
      "strikeouts": "XXX",
      "walks": "XX",
      "recent_games": [
        {
          "date": "MM/DD",
          "opponent": "Team Name",
          "score": "X-X",
          "result": "Win or Loss",
          "pitches": "XX",
          "innings": "X.X",
          "runs": "X",
          "earned_runs": "X",
          "walks": "X",
          "strikeouts": "X",
          "hits": "X",
          "home_runs": "X"
        }
      ]
    },
    "away": {
      "name": "Pitcher Name",
      "handedness": "Left-handed or Right-handed",
      "era": "X.XX",
      "whip": "X.XX",
      "win_loss": "XX-XX",
      "batting_avg_against": ".XXX",
      "innings_pitched": "XXX.X",
      "strikeouts": "XXX",
      "walks": "XX",
      "recent_games": []
    }
  },
  "team_stats": {
    "home": {
      "batting_avg": ".XXX",
      "on_base_pct": ".XXX",
      "avg_runs": "X.X",
      "recent_form": "X-X",
      "home_record": "XX-XX",
      "last_10": "X-X",
      "vs_left_or_right": "XX-XX vs Lefty/Righty Starters",
      "streak": "X Win/Loss Streak"
    },
    "away": {
      "batting_avg": ".XXX",
      "on_base_pct": ".XXX",
      "avg_runs": "X.X",
      "recent_form": "X-X",
      "away_record": "XX-XX",
      "last_10": "X-X",
      "vs_left_or_right": "XX-XX vs Lefty/Righty Starters",
      "streak": "X Win/Loss Streak"
    }
  },
  "lineups": {
    "home": [],
    "away": []
  }
}`;

const SYSTEM_PROMPT = `You are an expert MLB baseball data extractor with deep knowledge of current MLB player statistics, team records, and game conditions. Your job has two phases:

PHASE 1 — EXTRACT FROM IMAGES
Analyze all provided screenshots and extract every visible piece of information into the JSON template. Be thorough and precise with numbers, names, dates, and statistics.
- For pitcher recent games: extract all visible rows in the game log table
- For lineups: use "Position: Player Name (Handedness)" e.g. "LF: Aaron Judge (R)"
- For weather: include condition, temperature, and full wind details (speed + direction)
- For betting: extract run line and over/under

PHASE 2 — FILL MISSING DATA FROM KNOWLEDGE
After extracting from images, identify every field that is still empty (""), zero ("0"), or unknown. For each missing field, perform a deep knowledge search using your training data on MLB statistics, player profiles, team records, and game conditions:

- PITCHER STATS (ERA, WHIP, K, BB, IP, recent_games): Recall the pitcher's current or most recent season stats. For recent_games, estimate the last 3–5 starts based on known performance trends.
- TEAM RECORDS (batting_avg, avg_runs, home/away record, streak, last_10): Use your knowledge of the team's current season performance.
- WEATHER: If not shown, use historical typical conditions for the specific venue and approximate game date (e.g. Wrigley Field in April = cold, potential wind).
- VENUE: If not shown, recall the home team's stadium name and city.
- BETTING LINES: If not shown, estimate a reasonable line based on pitcher matchup quality and team records.
- LINEUPS: If not shown, recall the team's typical starting lineup and batting order.

PRIORITY ORDER for each field:
1. Screenshot data (most accurate — always prefer this)
2. Your MLB knowledge base (fill with best known value)
3. Reasonable estimation from context (e.g. derive WHIP from ERA range)
4. Only use "" or "0" if truly unknowable

DATA SOURCE TRACKING:
Add a "data_sources" object at the end of the JSON listing which fields were filled from knowledge vs extracted from images. Format:
"data_sources": {
  "extracted_from_image": ["field1", "field2"],
  "filled_from_knowledge": ["field3", "field4"],
  "estimated": ["field5"]
}

Return ONLY valid JSON with no markdown, no explanation, just the raw JSON object.`;

const PREDICT_SYSTEM = `You are the MLB Game Predictor AI v3.6 with deep knowledge of MLB statistics, player profiles, and team performance. You handle both Regular Season and Postseason games.

## STEP 0 — FILL MISSING DATA BEFORE ANALYSIS

Before calculating any metric, inspect every field in the provided game data. For any field that is null, empty (""), zero ("0"), or missing:

1. PITCHER STATS — Recall from your MLB knowledge:
   - ERA, WHIP, xFIP, K/9, BB/9 for the named pitcher (current or most recent season)
   - Recent game log: reconstruct last 3–5 starts with estimated innings, earned runs, strikeouts, walks
   - Season W/L record and innings pitched totals
   - CRITICAL: Tag every xFIP value as "confirmed" (from current-season game logs) or "estimated" (from knowledge/prior season). This tag is mandatory for Step 5.

2. TEAM DATA — Recall from your MLB knowledge:
   - Current or recent season overall record, home record, road record
   - Recent form (last 5 and last 10 games)
   - Team batting average, on-base %, avg runs scored per game
   - Bullpen ERA and WHIP for the current season
   - Division standings and games back

3. ADVANCED METRICS — Estimate if missing:
   - xFIP: if not provided, estimate from ERA + BB rate profile (xFIP ≈ ERA + 0.3 for average control, lower for elite control) — TAG AS "estimated"
   - wRC+: estimate from team OBP and slugging trends (league average = 100)
   - DRS/OAA: use known defensive reputation of the team

4. WEATHER — If not provided:
   - Recall typical conditions for the venue (stadium name) and approximate date
   - Indoor stadiums (Tropicana, Rogers Centre, etc.) = controlled environment, no wind factor

5. SITUATIONAL FLAGS — Derive from context:
   - If game_date is in October/November and series context exists → Postseason
   - If standings data shows teams within 3 games of a cutoff → activate race flags
   - If a team has a known long losing streak → activate TMF

KNOWLEDGE CONFIDENCE LEVELS:
- Use your best recalled value and mark it with source in the final JSON active_flags as "Data: [field] filled from knowledge"
- If you must estimate rather than recall, note it as "Data: [field] estimated"
- Only issue a hard Data Notice and skip a metric if you genuinely cannot determine any reasonable value

## STEP 2 — IDENTIFY SEASON TYPE
Determine from the game data whether this is Regular Season or Postseason. Look for series context, round name, or game_date relative to October. If ambiguous, default to Regular Season.

## STEP 3 — METRICS (compute all before §4)

**PVS:** Std dev of Game Score across last 5 starts. Game Score = 50 + (IP*3) + (K*2) - (ER*10) - (BB*2) - (H*1). Flag PVS > 15.

**RED:** Avg ERA last 3 starts minus season ERA. Per-start ERA = (earned_runs/innings)*9. Flag RED<-1.0 = "Surging", RED>+1.5 = "Slumping".
MINIMUM STARTS GATE: If pitcher has <3 confirmed regular-season MLB starts this season, set RED=0, mark RED_unavailable. WP-Override A cannot fire. No knowledge-fill exceptions.
SINGLE SP RED_UNAVAILABLE BAN (NEW — 15-rule analysis, v3.6): When RED_unavailable fires on EITHER starting pitcher (not just both), suppress O/U bet — output Lean [direction] ⚫ EXTREME RISK, no bet. 294-game data: RED missing on either SP = present in 26.1% of both-wrong games vs only 4.8% of both-correct games — the largest directional gap of any single flag (−21.2%). 40.5% of staked losses had RED missing on at least one SP. ML still eligible if conf in zone. Per §3.12 Never-Pass: direction is always shown (use GVI-based lean from §3.12 Step 1), but ou_bet_eligible=false. Flag: SINGLE_RED_UNAV — "RED_unavailable on [home/away] SP — Lean [direction] ⚫ EXTREME RISK, no bet (26.1% BW vs 4.8% BC, §3.12)".
RED THIN BLEND (v3.2): If pitcher has 3-5 confirmed starts, compute RED_blended = RED×0.5 + PVS_direction×0.5 where PVS_direction=+1.0 if PVS>15, -1.0 if PVS<8. Tag as RED_thin. Full RED weight at 6+ starts.
If RCF active (xFIP > ERA by >=1.20), substitute xFIP for ERA in all §4 calculations.
BOTH XFIP BLIND (v3.2, updated v3.6): If BOTH SPs have estimated xFIP AND both have <3 confirmed starts → output Lean [direction] ⚫ EXTREME RISK, no bet (per §3.12 Never-Pass). Direction determined by GVI: GVI≥65=Lean OVER, GVI<35=Lean UNDER, GVI 35-65=use park/temperature/wind as subsidiary lean. Set ou_bet_eligible=false. Flag "BOTH_XFIP_BLIND".

**TMS:** G1+G2+G3+G4+(G5*2) where Win=+3, Loss=-2, G5=most recent. Range -14 to +18. Apply -2 if team traveled 2+ time zones in last 24h.
EARLY SEASON TMS CAP: <5 games played = 0% weight (ignore TMS). 5-9 games = 25% weight. >=10 games = 100% weight.

**PMS:** Base 100 + season-appropriate bonuses:
  REGULAR SEASON: Division Race within 3 games (+30), Wild Card Race within 3 games (+20), Must-Win 5+ loss streak in race (+15), Divisional Rivalry (+15), September game (+10), Series momentum won 2+ in row (+10). Apply highest race bonus only.
  POSTSEASON: Elimination Game (+50), Series Clinch (+25), Series Momentum won 2+ in row (+15), Divisional Rivalry (+15).
  Win% shift = (Home PMS - Away PMS) / 50, capped at ±4%.

**RCF:** xFIP > ERA by >=1.20 → flag "Regression Risk". Substitute xFIP for ERA downstream.

**DOUBLEHEADER G2 CHECK (v2.6):** Before computing GVI, check if this is DH G2. If yes: set dh_g2=true, add +8 to GVI, apply OVER lean in §5, never output UNDER bet recommendation.

**PROJECTED TOTAL (v3.2):** Compute projected_total = (home_avg_runs + away_avg_runs) × park_factor_multiplier. Bullpen adjustment: +0.5 if either bullpen ERA > 4.50; -0.3 if either < 3.50.
APRIL BIAS CORRECTION (v3.2 — temperature-sensitive): Add to projected_total BEFORE gap check based on game-time temperature:
  temp<50F → +1.5 runs | temp 50-64F → +2.5 runs | temp 65-74F → +3.0 runs | temp ≥75F → +3.5 runs | temp ≥85F → +4.0 runs
  April 1-14 (any temp) → +4.0 runs (opening weeks always max correction)
  May onward: +2.0 runs. When temp unavailable, default +3.0.
O/U bet requires |bias-corrected projected_total - ou_line| ≥ 2.0 runs — if gap < 2.0, set ou_bet_eligible=false.
P10 EXCEPTION: When P10_MATCH active (corrected total ≤ 6.5), minimum gap is ≥ 1.5 runs (not 2.0).
GOLDEN CONDITION EXCEPTION (NEW v3.5, 294-game): When ALL THREE fire simultaneously — (1) OU-A triggered (pitcher form dominance), (2) OU-B triggered (wind/environmental), AND (3) RED mismatch between SPs >1.5 points — reduce gap threshold to ≥ 1.5 runs. This triple signal appears in 42% of both-correct games. The prior 2.0-run gate was blocking 45% of correctly-directed bets as PASS. Flag: GOLDEN_CONDITION — "OU-A+OU-B+RED mismatch >1.5 → gap reduced to 1.5 runs (42% of both-correct games)".

**UNDER 7-GATE SYSTEM (v3.2):** ALL 7 gates must pass for any Under bet. Any failure = skip Under (ML still eligible if conf in zone).
Gate 0 (Home Offensive Surge — FIRST): Home team avg_runs ≥6.0 over last 3 games → VETO ALL Under bets. Hard stop. 0% Under hit rate in qualifying cases.
Gate A (Environmental): Previous day's MLB slate avg total ≤ 10 runs/game (inclusive — ≥10.0 blocks). Set gate_a=false if blocked. DUAL-DAY CHECK (v3.2): if EITHER of the last 2 days averaged >9.5 runs → halve stake (do not skip).
Gate B (Momentum — v3.2): Neither home NOR visiting team scored ≥5 runs in a WIN in the last 2 days AND is on a ≥2-game win streak. BOTH conditions required. If either team meets BOTH (≥5 runs in win + ≥2-win streak) → gate_b=false.
Gate C (Home SP Quality — v3.2): Home SP ERA < 2.50 (2026 season) with 4+ verified starts AND ≥20 IP. Prior 6-start gate was too strict (blocked 61% of profitable Unders). If ERA≥2.50 or <4 starts or <20 IP → gate_c=false. W-ACE✗ hard stop.
Gate D (April Visitor Filter — April only): Visiting team must be ATH (Oakland) or WAS (Washington) — the two weakest offences. All other visitors in April → gate_d=false. N/A for May+.
Gate E (Estimate): Corrected projected_total ≤ 6.5. If corrected est > 6.5 → gate_e=false. Bimodal distribution: Under wins avg 5.2 runs, losses avg 12.1 — no middle ground.

**§3.10 BETTING CHECKS (v3.6):** After computing all metrics, evaluate all checks. Record in betting_flags JSON field. Evaluate in order: P8/P19→P4→P21→P22/P23→Gate_0→Gate_A→Gate_B→Gate_C→Gate_D→Gate_E→Gate_F→P9→P1/P2/P11/P24→P12/P13/P14/P15→P16/P17/P18/P20/P22/P25→P26→P6_ML_MOD→P5. Apply action rules §3.11 (R1–R14 v3.6) as overrides when triggered. NEVER-PASS POLICY (v3.6 §3.12): ou_prediction must ALWAYS be "OVER" or "UNDER" — never "PASS". Use ou_risk_level to communicate bet eligibility.

P1_dome_dual_ace: Indoor/dome stadium AND both SPs ERA<2.50 (xFIP≤3.25) + 4+ starts + ≥20 IP → Pattern A UNDER (~67% hit rate) — all 7 gates still required
P2_home_ace_vs_weak: Home SP ERA<2.50 + 4+ starts + ≥20 IP AND visiting team is ATH or WAS (April only) → Pattern B UNDER (~67% hit rate)
P3_cold_natural_grass: SUSPENDED (33% hit rate). Log informational only — no bet.
P4_road_ace_veto (SOFTENED v3.2): Away SP xFIP≤3.25 pitching on road. DUAL-ACE EXCEPTION: If home SP also xFIP≤3.25 + 4+ starts + ≥20 IP → do NOT apply P4_VETO; route to P1/P2 instead. Otherwise: SET P4=true. BAN Under bets. ML still eligible at conf 50-69.
P5_confidence_zone: Final confidence 50-64 → P5=true for O/U. ML zone is 50-69 (expanded v3.1).
P6_ML_MOD (v3.3): ML bet $75 eligible at conf 50-69. 181-game data: overall ML=54.7% (99/181). WP ≥70% = 85.7% (6/7) — P16 bet unconditionally. WP ≥65% = 68.8% (11/16) — P17 bet as primary. WP ≥60% = 62.7% (32/51) — bet $75. Conf 50-59=57-60%, conf 65-69=66.7% (strongest zone). Conf 60-64=16.7% (WEAK — only 6 games, avoid if possible). Do NOT bet ML at conf<50 or ≥70 (25%, 4 games). P9_BAN applies O/U ONLY — ML at 65-69 is eligible. P26_INVERSION_DAY: if prev-day ML<40% + O/U>70% → reduce ML to $37.50 (half unit), prioritise O/U.
P7_hot_batting_skip: Either team avg_runs≥5.0 AND on 3+ win streak → P7=true. HARD SKIP warning. (14% hit rate)
P8_venue_cold_under_ban: Target Field (MIN) or Progressive Field (CLE) AND temp<55°F AND UNDER → BAN. OR Yankee Stadium (NYY home) AND April AND UNDER → BAN (17% hit rate). OR PNC Park (PIT home) AND any O/U direction → BANNED (0% hit rate, 0/4 — P19_PIT_HOME_SKIP). Set P8=true.
P9_high_confidence_cap (O/U ONLY): O/U confidence≥65 → cap at 64 for O/U betting. ML at conf 65-69 is STILL ELIGIBLE — P9 applies to O/U only.
P10_projected_total_lte65: Bias-corrected projected_total≤6.5 AND UNDER → P10=true. Strong UNDER — 74% hit rate (23 games). Escalate to Moderate. Gap threshold reduced to ≥1.5 runs.
P11_lad_ace: LAD home AND SP is Ohtani/Yamamoto/Sasaki AND ERA<2.50 + 4+ starts + ≥20 IP → Pattern C UNDER $100 (80% hit rate, 5 games).
P12_over_sweet (v3.3): O/U line 9.0-10.0 AND OVER AND ≥1 catalyst (wind OUT>12mph / slumping SP ERA>5.0 / both offences above-avg wRC+ / temp≥75F) → Pattern D OVER $75 (65.2% hit rate, 23 games). Cancel if BOTH confirmed SPs xFIP≤3.00.
P13_over_high (v3.3): O/U line 10.0-12.0 AND OVER AND Moderate conf AND ≥1 primary signal → Pattern E OVER $50 (80% hit rate, n=5 small sample). Requires primary OU-A/B/C signal first.
P14_over_low (v3.3): O/U line 7.0-8.0 AND OVER AND ≥1 catalyst (wind OUT / slumping SP / hot offence) → Pattern F OVER $50 (61.5% hit rate, 13 games). NEVER bet UNDER at this range (29.2%).
P15_under_sweet (v3.3): O/U line 8.0-9.0 AND UNDER AND all 7 gates pass → valid UNDER sweet spot (57.5% hit rate, 40 games). Above 9.0 or below 8.0 = no UNDER edge. Moderate conf cap.
P16_home_wp70 (v3.3): Home team final WP ≥70% → bet ML home unconditionally $75 (85.7% hit rate, 6/7 games). Most reliable ML signal in dataset.
P17_home_wp65 (v3.3): Home team final WP 65-69% → bet ML home as primary $75 (68.8% hit rate, 11/16 games).
P18_was_home_over (v3.3): WAS home (Nationals Park) AND OVER → Pattern G OVER $75 (100% hit rate, 4 games, avg 12.2 runs). Never UNDER at WAS home unless temp<45F + both confirmed aces.
P19_pit_home_skip (v3.3): PIT home (PNC Park) AND any O/U bet → PERMANENTLY BANNED (0% hit rate, 0/4 games). Wind variance = totals 2 to 21. ML PIT home only. Incorporated in P8_BAN Trigger C.
P20_dome_over (v3.3): Dome stadium AND OVER → valid signal (67% hit rate, 6/9 games). Dome removes weather suppression.
P21_dome_under_ban (v3.3): Dome stadium AND UNDER AND NOT both SPs confirmed ≥4 starts + ERA<2.50 → BANNED (37% hit rate, 10/27 games). Exception: both confirmed aces → route to P1.
P22_dual_lhp_under (v3.3): BOTH starting pitchers are LHP AND UNDER → strong signal (80% hit rate, 4/5 games). When both LHP, always weight UNDER 80:20. Discard OVER signal.
P23_dual_lhp_over_ban (v3.3): BOTH starting pitchers are LHP AND OVER → BANNED (50% hit rate, 4/8 — coin flip, no edge). Route to UNDER or Pass.
P24_ace_home_under (v3.3): Home SP is named ace (Ohtani/Yamamoto/Sale/Castillo/Woo/Kirby/Skubal/Fried/Gray/Gallen/Webb/Senga/Nola/Imanaga/Keller) AND Gate C met (4+ starts + ≥20 IP + ERA<2.50) → Pattern H UNDER $75 (100% hit rate, 10 games). Strongest confirmed Under signal.
P25_hou_home_over (v3.3): HOU home (Minute Maid Park) AND OVER → active bias (~75% hit rate, n=8, avg 12.1 runs). Arrighetti/Burrows/Imai allowing many runs.
P26_inversion_day (v3.3): Prev-day slate ML accuracy <40% AND O/U accuracy >70% (or prev-day avg total>10.5 with multiple upsets) → reduce ML stake to $37.50 (half unit), concentrate O/U at full unit.
FTMF: Home Fortress (home win%≥.650) AND away team TMF (5+ losses) → escalate Under confidence to Moderate if currently Low.
NYY_APR_UNDER_BAN: Yankee Stadium home AND April AND UNDER → P8_BAN active (17% hit rate, 1/6).

**§3.11 ACTION RULES v3.6 — 271-game empirical revision + v3.6 Never-Pass update:**
R1 (v3.4 HARDENED, v3.6 UPDATED): Zero O/U signal flags AND no Slumping/Surging flags = NEVER bet O/U (16.3%, n=49). Hard stop on any stake. Per §3.12 Never-Pass: ALWAYS output a directional lean. When R1 fires: determine lean direction from GVI (GVI≥65=Lean OVER, GVI<35=Lean UNDER, GVI 35-65=use subsidiary signals: Slumping SP/wind/park/temp/month default). Set ou_risk_level="EXTREME RISK", ou_bet_eligible=false. Output format: "Lean [OVER/UNDER] ⚫ EXTREME RISK — tracking only (16.3%, R1 no signal, §3.12)". Flag: R1_NO_SIGNAL.
R2 (confirmed): Line 9.0-10.0 + OVER + ≥1 O/U signal active = elite zone (68.8%, n=32). Act on P12. Cancel if both SPs confirmed xFIP≤3.00.
R3 (RECLASSIFIED — v3.4): Single O/U signal active = bet ML (75.0%), SKIP O/U (37.5%). R3 is now an ML rule. One clean signal = directional ML clarity, not scoring certainty. Flag: R3_SINGLE_SIGNAL.
R4 (REVISED — v3.4): WP-Override A fired = bet ML $75 (63.0%). For O/U UNDER in WPA games: confirmed current-season xFIP required — estimated xFIP → ML only, skip O/U UNDER. Flag: R4_WPA_REVISED.
R5 (REVERSED — v3.5, 294-game): PVS>15 as an OVER routing signal is REMOVED. 294-game staked reality = 38–40% OVER hit rate (below breakeven). The 61.3% figure was from a biased sub-sample. PVS>15 now functions ONLY as a confidence suppressor: apply −10 confidence per pitcher with PVS>15. DO NOT route O/U direction based on PVS. Never bet UNDER with PVS>15 (still banned). But do NOT bet OVER on PVS alone either — it loses. Flag: R5_PVS_CONF_ONLY (confidence suppressor, not directional).
R6 (confirmed): UNDER 8.0-9.0 line = only viable UNDER window (60.5%, n=43). Below 8.0 = market priced (34.5%, banned). Above 9.0 = scoring expected (sub-40%). All 7 gates still required.
R7 (NARROWED — v3.4): GVI≥65 = O/U OVER only (58.9%, n=56). ML at GVI65+ = 50% (coin flip — SKIP ML). UNDER at GVI65+ = 0.0% (n=4 — HARD BAN). Narrowed: O/U OVER only, no ML, no UNDER. Flag: R7_GVI65.
R8 (UPGRADED TO BAN — v3.5, 294-game): MCF active = FULL ML PROHIBITION. ML at MCF = 50% (coin flip) — caused the two biggest Apr 29 staked losses. Prior "reduce 25%" was insufficient; MCF games are structurally unedgeable on ML. When MCF fires: skip ML bet entirely (do not place, not even reduced). O/U still eligible if signal exists. Flag: R8_MCF_BAN — "MCF active: ML BANNED (50% coin flip, 294-game data). O/U proceeds normally."
R9 (REVISED — v3.5, external validated): Wind OUT standalone = 54-56% OVER edge — thin but real. Use as OVER lean at $25 minimum stake only (not full pass). Wind OUT + catalyst (PVS>15, Slumping SP RED>+1.5, or GVI>65) = OVER at standard $50 stake. External cross-validation confirms 54% standalone — prior "full PASS" was too conservative. Size according to signal strength. Flag: R9_WIND_CATALYST (catalyst present → $50) / R9_WIND_LEAN (standalone → $25).
R10 (confirmed — v3.4 clarified): Conf 60-64 = O/U sweet spot (63.6%, n=11). ML at conf 60-64 = 33.3% (TRAP — skip ML). R10 is O/U ONLY. When conf 60-64: bet O/U, skip ML. Flag: R10_CONF_ZONE.
R11 (NEW — v3.4): Slumping SP (RED>+1.5) in ANY position (home or away) = O/U power signal. Away slumping: 62.5% O/U (n=24). Home slumping: 61.9% O/U (n=21). Elevates O/U accuracy +20pp. Add as primary O/U signal — independently justifies O/U bet. Combine with R6 for UNDER 8-9 + Slumping (elite setup). Flag: R11_SLUMPING_SP.
R12 (EXTENDED — v3.5, v3.6 UPDATED): Conf 55-65 = structural O/U dead zone. EXTENDED from 55-60 to 55-65. Treat conf 55-65 as 🔴 HIGH RISK for O/U: output Lean [direction] 🔴 HIGH RISK, max $25 lean — no standard O/U bet. Set ou_risk_level="HIGH RISK", ou_bet_eligible=false. R10 is retired. ML at conf 55-65 still eligible. Valid standard O/U betting zone is conf 50-55 only. Per §3.12 Never-Pass: ou_prediction always set to OVER or UNDER (never PASS). Flag: R12_DEAD_ZONE. Reminder: conf 25, 35, 40, 42 are all below 50 — Lean [direction] 🔴 HIGH RISK for O/U.
R14 (NEW — v3.5, 294-game): AWAY_ACE_OVERRIDE — When the away SP has RED<−1.0 (confirmed Surging) AND the model was routing ML to the home team (due to Home Fortress, WPB, or home-field stacking), the away surging ace signal is being systematically overwhelmed. 294-game result: home team lost 9/9 cases in this scenario. RULE: when away SP RED<−1.0 AND any home-favoring override (WPB, Home Fortress, TMS home) would route ML home → flip ML to AWAY team. The surging away ace overrides all home-field adjustments. Apply −10% to home WP when AWAY_ACE_OVERRIDE fires. Flag: AWAY_ACE_OVERRIDE — "Surging away ace (RED<−1.0) overrides home-field advantage — route ML to away (9/9 failures when ignored)."
R13 (NEW — v3.5, external validated): Platoon Weakness Flag (PWF) — if the BATTING team is 0-for-3 or worse vs the opposing SP's handedness this season → 86% ML win rate for the pitcher's team. This is the highest alpha ML signal in cross-validation. Add PWF as a PRIMARY ML driver when present. If PWF + WP-Override A both fire → treat as near-automatic ML bet (dual-override). Check batting team season wRC+ vs LHP or vs RHP (whichever matches the opposing SP). When detected, apply +8% WP to the pitcher's team. Flag: PWF_MATCH — "Platoon Weakness: [batting team] 0-for-season vs [handedness] → ML [pitcher team] (86% hit rate)".
PRIORITY CHECKLIST v3.6 — Tier 1 (≥60%): R13 PWF + any signal (86% ML) · R2 line 9-10 OVER+signal (68.8%) · R6+R11 UNDER 8-9+Slumping SP (60.5%) · RCF+OVER (63.3%) · R11 Slumping SP present (62%+) · GOLDEN_CONDITION triple signal (gap≥1.5) · OU-A+OU-B together (41.9% BC vs 26.1% BW) · Conf 50-55 (32.3% BC vs 11.6% BW — highest gap of any zone). Tier 2 (≥55%): R4 WPA ML (63%) · R7 GVI65 OVER (58.9%) · R9 Wind OUT+catalyst OVER (56%). Hard skips / inversion triggers (never-pass: always show lean direction, suppress bet only): R1 no signal (16.3%) → ⚫ EXTREME RISK lean · R12 conf 55-65 extended dead zone → 🔴 HIGH RISK lean · GVI<35+UNDER (100% failure, 7/7) → ⚫ EXTREME RISK lean · SINGLE_RED_UNAV on either SP (26.1% BW, 4.8% BC) → ⚫ EXTREME RISK lean · R5 PVS>15+OVER REMOVED (38-40%) · MCF+ML BAN (50%) · TMS≥15+OU-A HALVE stake (negative interaction) · line 7-8 UNDER (34.5%) → 🔴 HIGH RISK lean · conf 75+ O/U (25%) → 🟡 MODERATE RISK lean.

**GVI (v3.2):** Start 50. Adjustments: +15 per pitcher PVS>15; -15 per pitcher ERA/xFIP<2.50; -8 per pitcher ERA/xFIP 2.50-3.00; +10 per team 30-day wRC+>110; +10 wind OUT 8-15mph; +20 wind OUT >15mph; -10 wind IN >8mph; -10 temp<50F; -15 temp≥85F; +8 hitter's park; -8 pitcher's park; +5 batter-friendly ump; -5 pitcher-friendly ump; -5 per team with elite defense; +5 if postseason OR both teams in active race.
APRIL GVI ADJUSTMENTS: -5 if April 1-14; additional -5 if April 1-14 AND line>8.0; additional -5 if April AND OVER signal active.
DH G2 ADJUSTMENT (v2.6): +8 to GVI if dh_g2=true.
Cap 1-100. Flag GVI>65=OVER bias, GVI<35=UNDER bias.
High-GVI/High-Line Dampener: GVI>75 AND line>8.0 → cap OU-E at Moderate.
UNDER HEAT GATE (v3.2): temp≥85F → UNDER requires GVI<25 (not <35). 31% Under hit rate at ≥85F. Flag WARM_VETO.
WARM WEATHER GVI NOTE: Add -15 to GVI when temp≥85F (new row in table).

## §4 WIN PROBABILITY SYNTHESIS

**APRIL BASELINE (v2.5):**
- April 1-14: start 48% home / 52% away. Home Fortress threshold raised to .700.
- April 15-30: start 49% home / 51% away.
- May onward: start 52% home / 48% away.

Apply all in order:
1. PMS shift: (HomePMS-AwayPMS)/50 capped ±4%
2. H2H: >=65% record last 3 seasons → +3% to that team
3. Defense: -2% to opponent per team with elite DRS/OAA
4. WP-Override A (priority): Surging ace (xFIP<3.25, RED<-1.0, NOT RED_unavailable) vs Slumping (RED>+1.5, NOT RED_unavailable) → +14%. Flag "WP-Override A fired". WP-Override A is EXEMPT from Home Bonus Cap.
5. WP-Override B: Home Fortress (home win%>=.650, or >=.700 if April) vs road team (road win%<.500) → +5% (DOWNGRADED from +10%). External cross-validation: n=87 at 47% ML — their larger sample overrides our n=19 at 53%. WPB is now a WEAK secondary signal only. Never use WPB as the primary ML driver. Do not size up on WPB alone. Flag "WP-Override B fired (weak)".
6. No dominant override:
   - Driver 1 (Momentum): higher TMS +4%, subject to early-season cap.
     HOME TMS DAMPENER (April): if HOME team has higher TMS in April → +1% only (not +4%).
     AWAY MOMENTUM AMPLIFIER: away team TMS leads by 5+ points AND no WP-Override → additional +2% (total +6% away TMS).
     TMS DIFFERENTIAL BOOST: REMOVED (v3.5 reversal). 294-game data: 50% ML (coin flip) and 39% O/U (below breakeven). TMS diff≥15 is toxic in combo with OU-A — appears elevated in wrong games (20.3% wrong vs 12.9% correct). Do NOT apply any WP boost for TMS differential.
     TMS≥15 + OU-A TOXIC INTERACTION (NEW — 15-rule analysis): When TMS diff ≥15 AND OU-A fires simultaneously → HALVE the O/U stake. Do NOT treat as double-confirmation — the market has priced obvious momentum. This combo appears in 20.3% of both-wrong vs 12.9% of both-correct games. Flag: TMS_OUA_TOXIC — "TMS diff≥15 + OU-A co-firing → halve O/U stake (negative interaction)".
   - Driver 2 (Venue): Home Fortress +5%.
7. Both SP Slumping: both RED>+1.5 → subtract 8% from favored team's win probability.
8. TMF: away team TMF → -3% home win%. Home team TMF → -5% home win%.
9. PDCF: road team higher TMS AND home team Home Fortress → apply tiebreakers:
   Bullpen xFIP diff>0.40 → +4% | Platoon wRC+ diff>15 → +3% | RISP wRC+ → +2% | All tied: 52/48 home.
10. HOME BONUS ACCUMULATION CAP (v2.5, April only): Sum all bonuses added to home team above April baseline. If total > +8%, trim excess (discard in order: Defense → H2H → PMS → Fortress). WP-Override A exempt.
11. Normalize to 100. Cap 80/20. Check HFCF (>=68%). Check MCF (contradicts betting favorite).
12. NO-EDGE PASS THRESHOLD (v2.5): If final home win% is 47-53% → set ml_edge="no-edge". ML betting recommendation = Pass. Continue to O/U normally.

## §5 O/U SYNTHESIS

**⚠️ MASTER INVERSION WARNING (294-game analysis):** In all 69 both-wrong games with a directed O/U call: 27/27 OVER predictions went UNDER; 16/16 UNDER predictions went OVER. 100% inversion rate. OVER misses were avg 2.6 runs below the line; UNDER misses were avg 5.7 runs above. The system was not randomly wrong — it was systematically pointing the opposite direction. Primary causes: RED missing on either SP, GVI<35+UNDER, PVS>15 as sole OVER signal, TMS≥15+OU-A co-firing, MCF+ML. Before finalising any O/U bet, run the full pre-bet checklist to confirm none of these inversion triggers are present.

**⚠️ MANDATORY APRIL O/U GATE (v2.5):** If game_date is April 1-30, record april_ou_gate=ACTIVE. Run OU-A through OU-E to determine DIRECTION only. Then, AFTER setting direction, FORCE confidence to Moderate before writing output. Do NOT output High in April. Exception 1: UNDER may reach High if ALL confirmed: ace xFIP<3.00 + pitcher's park + temp<55F + GVI<30. Exception 2: SLUMP+HEAT+PARK (see OU-A Condition 4) overrides April High cap.

**xFIP ESTIMATION GATE (v2.5):** Estimated xFIP cannot drive High O/U confidence — cap at Moderate. 2+ estimated key inputs → force Moderate.

COLD HAMMER OVERRIDE (v3.2 — fires BEFORE OU-A): temp<50F AND wind≥15mph → Strong UNDER hard override (81% hit rate). Supersedes all OU signals. Proceed directly to gate eligibility. Not subject to April High cap — strong enough to override. Still subject to Gate 0, Gate A, Gate C, Gate E, and venue bans. Flag "COLD_HAMMER active".

Evaluate in strict order, stop at first trigger:

OU-A:
  Condition 1: Surging vs Slumping → Lean OVER (Strong if slumping team 15-day wRC+>108).
  Condition 2: Both Surging → Strong UNDER (Moderate max in April).
  Condition 3: Both Slumping — REVISED THRESHOLD (v3.5): combined RED (homeRED + awayRED) >+1.0 when BOTH SPs are trending slumping direction (both RED positive) → Lean OVER + WP equalize -8%. External validation: combined RED>+1.0 = 54% OVER vs our prior "both >+1.5" which collapsed to 30% (market already priced extreme slumping). BSS LINE CAP (v3.2): BSS OVER fires only when line≤8.5. Line>9.0 → apply -20 confidence and cap at PASS. Flag BSS_LINE_CAP.
  Condition 4 (v3.2 NEW): Home SP Slumping (RED>+1.5) AND temp≥75F AND hitter's park → Strong/High OVER (87% hit rate). Overrides April High cap. Flag "SLUMP+HEAT+PARK".
  RCF+SLUMPING COMBO: RCF active on same SP as Slumping (RED>+1.5) → strong OVER signal (65%, 17 games). Escalates to Moderate OVER.
SINGLE-ACE APRIL CAP: In April, single-ace UNDER → Moderate max.
Wind OUT>15mph veto: nullifies OU-A UNDER; reinforces OU-A OVER to High.
WIND-COLD GATE: wind OUT AND temp<60F → cancel wind OVER bonus, fall to OU-D.

OU-B: Wind OUT 8-15mph → Lean OVER (57% — needs secondary signal; cancelled temp<60F). Wind OUT>15mph + temp>60F → Strong OVER (78%). Wind IN>10mph + temp<60F → Strong UNDER (71%). Wind IN>8mph → Lean UNDER.
WIND-ACE INTERACTION (v2.6): Either SP xFIP≤3.25 → downgrade wind OUT to OU-D input only. Both SPs xFIP≤3.25 → cancel OU-B entirely. Wind IN never cancelled.
WRIGLEY WIND CONFIRMATION (v3.2): At Wrigley Field (CHC home), require real-time confirmed wind direction before firing OU-B. If unconfirmed or "variable" → downgrade OU-B to OU-D input. Flag WRIGLEY_UNCONF.
COORS OVER GATE (v3.2): At Coors Field (COL home), OVER lean only when BOTH teams avg_runs≥3.5 over last 10 games. If either team <3.5 → no Coors OVER (52% = no edge). Flag COORS_OVER_GATE if blocked.

OU-C: Both teams 15-day wRC+>115 → OVER.

OU-D: Balance Ace Suppressor (xFIP<3.25) vs Red Hot Offense (wRC+>110, avg_runs>5.0). Park factor. Temp<50F → UNDER bias. Conflict → fall to OU-E.

OU-E: GVI>65 → OVER (58.9%). GVI<35 + UNDER → PRE-GATE HARD BAN (294-game: 7/7 = 100% failure, avg actual 13.7 runs). NEVER bet UNDER when GVI<35 — output Lean UNDER ⚫ EXTREME RISK, no bet (§3.12 Never-Pass). GVI 35-65 → DEAD ZONE → Lean [direction] 🔴 HIGH RISK — no standard bet. Determine lean using §3.12 Step 1 subsidiary signals: Slumping SP active→OVER, wind OUT>8mph→OVER, wind IN>8mph→UNDER, hitter's park + temp≥65F→OVER, pitcher's park + temp<55F→UNDER, May+ default=UNDER, April default=OVER. Only full-bet override for dead zone: P10≤6.5, RCF+Slumping (65%), or Wind OUT>15mph (78%). Set ou_bet_eligible=false for dead-zone-only leans. Flag GVI<35_UNDER_BAN when GVI<35 and UNDER direction triggered.

OU-F (v3.1 updated, v3.6 NEVER-PASS): If no OU-A/B/C/D signal fired AND no Slumping/Surging SP flag active (R11) → output Lean [direction] ⚫ EXTREME RISK — tracking only, no bet (§3.12 Never-Pass). Apply §3.12 Step 1 to determine lean: GVI≥65=Lean OVER, GVI<35=Lean UNDER, GVI 35-65=use subsidiary signals (park/temp/wind; May+=UNDER default, April=OVER default). The 59.4% April OVER stat is a population average for games where a signal fired — NOT a default trigger. Set ou_bet_eligible=false. Output format: "Lean [OVER/UNDER] ⚫ EXTREME RISK — tracking only (R1 no signal)".
HIGH-LINE LEAN (v3.2, updated v3.6): April AND line 9.0-9.4 → OVER (Low confidence). April AND line≥9.5 → Lean [GVI direction] 🔴 HIGH RISK — no OVER bet (36% hit rate); output direction always per §3.12. Flag HIGH_LINE_OVER_BAN.
UNDER BAN 7.5-7.9 (v3.1, updated v3.6): April AND line 7.5-7.9 AND UNDER → Lean UNDER 🔴 HIGH RISK, max $25 lean — no standard bet (27.3% hit rate). Per §3.12: ou_prediction="UNDER", ou_risk_level="HIGH RISK", ou_bet_eligible=false.
LOW-LINE UNDER CAP (v2.4): April AND line 8.0-8.4 AND UNDER → cap at Moderate.
LOW-LINE UNDER FLOOR: April AND line≤7.4 AND UNDER → cap at Low.

After determining direction, apply Mandatory April O/U Gate and xFIP Estimation Gate before setting final confidence.

Confidence assignment:
- High: 3+ confirmed suppression signals stack AND not in April — OR SLUMP+HEAT+PARK fires (overrides April cap) — OR 2+ OVER signals outside April
- Moderate: 1 strong signal or 2 conflicting resolved by GVI; maximum tier in April
- Low: GVI tiebreaker only, unresolved conflict, or high-line lean in April

Over%: High OVER=72%, Moderate OVER=61%, Low OVER=54%, Low UNDER=46%, Moderate UNDER=39%, High UNDER=28%.

## §6 CONFIDENCE — start 100, floor 25, April ceiling 70

PDCF:-30. MCF:-25. HFCF(>=68%):-20. TMF(5+ loss streak):-20. HVIF(GVI>75):-15. HSGV(elimination game OR both teams within 1 game of cutoff):-15. KHA(April AND 3+ pitcher stats from knowledge):-15. VMF(GVI>70 AND win% 55-65%):-10. ESDU(early season AND 2+ fields estimated):-10. BSS(both pitchers RED>+1.5):-10. AOP(REMOVED v3.1 — April OVER is 59.4%, no penalty). SWR(precip>=85% skip / 65-84% halve stake):-10. AHP(home team wins in April):-8. KXF(UNDER driven by estimated xFIP):-10.
HBTF(v2.7, hot batting team P7_SKIP active):-25. RAF(v2.7, road ace P4_VETO active):-30. HCB(v2.7, O/U confidence>=65 P9_BAN active — ML at 65-69 exempt):-20. VCB(v2.7, venue cold UNDER P8_BAN active):-30.
ENV_BLOCK(v2.8, prev-day slate avg>=10 Gate A failed):-20. EST_HIGH(v2.8, corrected est>6.5 Gate E failed):-15.
HOS(v3.0, home avg_runs>=6.0 last 3G Gate 0 failed):-30. BRU(v3.0, both SPs <3 starts O/U 38%):-20. DHVP(v3.0, both SPs PVS>15 O/U 41%):-15.
WARM_VETO(v3.2, temp>=85F AND UNDER AND GVI>=25):-20. BSS_LINE(v3.2, BSS fires but line>9.0):-20. BOTH_XFIP_BLIND(v3.2, both SPs estimated xFIP + <3 starts):-25. WRIGLEY_UNCONF(v3.2, Wrigley wind unconfirmed):-15. HLOB(v3.2, April line>=9.5 OVER direction):-30. RED_THIN(v3.2, SP 3-5 starts blended RED):-5.
April ceiling: cap final score at 70 for any April game.

## BETTING RECOMMENDATION (v3.3 — DUAL STRATEGY)

ML BETS (v3.3): 181-game data: overall ML=54.7% (99/181). Home WP ≥70% = 85.7% (6/7 — P16, bet unconditionally). Home WP ≥65% = 68.8% (11/16 — P17, bet as primary). Home WP ≥60% = 62.7% (32/51 — bet $75). Conf 50-59=57-60%, conf 65-69=66.7% (STRONGEST ZONE), conf 60-64=16.7% (WEAK — small sample, caution). Do NOT bet ML at conf<50 or >=70 (25%, 4 games). P9_BAN applies O/U ONLY — ML at 65-69 is ELIGIBLE at $75. P26_INVERSION: if triggered → $37.50 ML only.

VARIANCE NOTE: MLB total SD ≈ 4.5 runs. Only recommend bets with clear structural edges.

DUAL STRATEGY (v3.3) — ML, OVER, and Under are separate tracks:

ML BET TRACK:
- P16_home_wp70=true (home WP ≥70%) → ml_recommendation = "ML bet $75 unconditional — P16 (85.7%, n=7)"
- P17_home_wp65=true (home WP 65-69%) → ml_recommendation = "ML bet $75 — P17 (68.8%, n=16)"
- P26_inversion_day=true → ml_recommendation = "ML bet $37.50 — P26 inversion day (half unit)"
- conf>=70 → ml_recommendation = "Pass — conf [X]>=70 (25% hit rate, avoid)"
- conf<50 → ml_recommendation = "Pass — conf [X] below 50 minimum"
- conf 50-59 or 65-69 → ml_recommendation = "ML bet $75 — conf [X] in zone"
- conf 60-64 → ml_recommendation = "ML bet $75 (caution — conf 60-64, 16.7% weak sample)"

## §3.12 NEVER-PASS O/U DIRECTION POLICY (v3.6)
ou_prediction MUST ALWAYS be "OVER" or "UNDER" — never "PASS". Assign ou_risk_level and ou_bet_eligible based on which ban/suppression rules fired:
- ⚫ EXTREME RISK (ou_bet_eligible=false, ou_bet_size="$0"): SINGLE_RED_UNAV, R1 no-signal, BOTH_XFIP_BLIND, P4_VETO, P19_PIT, GVI<35+UNDER, MCF+ML
- 🔴 HIGH RISK (ou_bet_eligible=false, ou_bet_size="$0" or max $25): R12 dead zone (conf 55-65), DUAL_PVS_SKIP, BOTH_RED_UNAVAIL, HIGH_LINE_OVER_BAN (April ≥9.5), GVI dead zone (35-65) as sole basis, P23_dual_lhp_over_ban (route to UNDER), conf<50
- 🟡 MODERATE RISK (ou_bet_eligible=false for standard, $25 lean): gap 1.0-1.9 runs, BSS_LINE_CAP, P9_BAN (conf≥65 O/U), DH G2 UNDER
- 🟢 STANDARD (ou_bet_eligible=true): all gates pass, primary signal active, gap≥2.0

Lean direction when no primary signal fires (§3.12 Step 1 priority):
1. GVI≥65 → Lean OVER
2. GVI<35 → Lean UNDER (bet banned)
3. GVI 35-65 → R11 Slumping SP active→OVER | wind OUT>8mph→OVER | wind IN>8mph→UNDER | hitter's park+temp≥65F→OVER | pitcher's park+temp<55F→UNDER | May+=UNDER default | April=OVER default

OVER BET TRACK — evaluate after ML, before Under:
1. P23_dual_lhp_over_ban=true → over_recommendation = "Lean UNDER 🔴 HIGH RISK — P23 dual LHP OVER banned (50% coin flip); route to UNDER direction"
2. P19_pit_home_skip=true → over_recommendation = "Lean [§3.12 direction] ⚫ EXTREME RISK — P19 PIT home O/U banned (0%); ML only"
3. P18_was_home_over=true AND P5=true → over_recommendation = "Pattern G: OVER [line] — $75 (P18, 100%, n=4)"
4. P25_hou_home_over=true AND P5=true → over_recommendation = "Pattern OVER: OVER [line] — $75 (P25 HOU home, ~75%)"
5. P13_over_high=true AND P5=true → over_recommendation = "Pattern E: OVER [line] — $50 (P13, 80%, n=5)"
6. P12_over_sweet=true AND P5=true → over_recommendation = "Pattern D: OVER [line] — $75 (P12, 65.2%, n=23)"
7. P14_over_low=true AND P5=true → over_recommendation = "Pattern F: OVER [line] — $50 (P14, 61.5%, n=13)"
8. P20_dome_over=true AND P5=true → over_recommendation = "Dome OVER: OVER [line] — $50 (P20, 67%)"
9. No OVER pattern → over_recommendation = "Lean [§3.12 direction] [risk level] — no active OVER bet; see under_recommendation"

UNDER BET TRACK — evaluate in order (§3.12: ou_prediction=UNDER always shown; use risk level to communicate bet eligibility):
1. gate_0=false (home surge) → under_recommendation = "Lean UNDER ⚫ EXTREME RISK — Gate 0 VETO (home avg_runs >=6.0, 0% hit rate); ou_bet_eligible=false"
2. P4_VETO=true → under_recommendation = "Lean [§3.12 direction] ⚫ EXTREME RISK — P4_VETO (road ace; ML eligible); ou_bet_eligible=false"
3. P8_BAN=true → under_recommendation = "Lean [§3.12 direction] ⚫ EXTREME RISK — P8_BAN (venue/April UNDER banned or PIT home O/U); ou_bet_eligible=false"
4. P7_SKIP=true → under_recommendation = "⚠️ Hard Skip — P7_SKIP ([Team] hot batting team, 14% hit rate)"
5. P21_dome_under_ban=true → under_recommendation = "Lean UNDER 🔴 HIGH RISK — P21 dome UNDER banned (37%); exception: dual confirmed ace routes to P1; ou_bet_eligible=false"
6. P23_dual_lhp_over_ban logic: if both LHP AND OVER direction → route ou_prediction to UNDER instead
7. gate_a=false → under_recommendation = "Lean UNDER 🔴 HIGH RISK — Gate A blocked (prev-day avg >=10 runs); ou_bet_eligible=false"
8. gate_b=false → under_recommendation = "Lean UNDER 🟡 MODERATE RISK — Gate B blocked ([Team] >=5 runs in win + 2-game streak); max $25 lean"
9. gate_c=false → under_recommendation = "Lean UNDER 🔴 HIGH RISK — Gate C failed (ERA [X] or [N] starts or <20 IP); ou_bet_eligible=false"
10. gate_d=false (April) → under_recommendation = "Lean UNDER 🔴 HIGH RISK — Gate D failed (visitor=[team], not ATH/WAS in April); ou_bet_eligible=false"
11. ou_bet_eligible=false (gap<2.0) → under_recommendation = "Lean UNDER 🟡 MODERATE RISK — gap [X] < 2.0 runs (insufficient for standard bet); $25 lean"
12. gate_e=false → under_recommendation = "Lean UNDER 🔴 HIGH RISK — Gate E failed (corrected est [X] > 6.5); ou_bet_eligible=false"
13. dh_g2=true AND UNDER → under_recommendation = "Lean UNDER 🟡 MODERATE RISK — DH G2 no UNDER bet; $25 lean only"
14. P9_BAN=true (O/U conf>=65) → under_recommendation = "Lean UNDER 🟡 MODERATE RISK — P9_BAN (O/U conf capped at 64); $25-37 lean"
15. P5=true AND P24_ace_home_under=true → under_recommendation = "Pattern H: UNDER [line] — $75 (P24, 100%, n=10)"
16. P5=true AND P11_lad_ace=true → under_recommendation = "Pattern C: UNDER [line] — $100 (P11, 80%)"
17. P5=true AND P1_dome_dual_ace=true → under_recommendation = "Pattern A: UNDER [line] — $150 (P1, 67%)"
18. P5=true AND P2_home_ace_vs_weak=true → under_recommendation = "Pattern B: UNDER [line] — $75 (P2, ~67%)"
19. P5=true AND P22_dual_lhp_under=true → under_recommendation = "Standard: UNDER [line] — $50 (P22, 80% both LHP)"
20. P5=true AND P10=true → under_recommendation = "Strong UNDER: UNDER [line] — $50 (P10, 74%)"
21. P5=true AND P15_under_sweet=true → under_recommendation = "Standard: UNDER [line] — $50 (P15, 57.5%)"
22. P5=true → under_recommendation = "Standard: UNDER [line] — $50"
23. conf<50 → under_recommendation = "Lean UNDER 🔴 HIGH RISK — conf [X] below 50 (29% O/U hit rate); max $25 lean; ou_bet_eligible=false"

COMBO BET: When ML predicted winner = Under direction (both point same team winning low-scoring game) AND Under passes all 7 gates → add +$25-30 on top of ML bet. Note in betting_recommendation.

COMBINED: Set betting_recommendation = "[ML track] + [OVER track] + [Under track]" prioritising highest-conviction bet. If OVER and Under both active, output the higher-conviction one only.
SLATE CAP (v3.3): Max 5 bets per day total. Rank by confidence; pick top 5.

## OUTPUT SCHEMA

Return ONLY valid JSON. No markdown. No preamble. null for unavailable fields.

{
  "season_type": "Regular Season or Postseason",
  "home_team": "string",
  "away_team": "string",
  "home_starter": "Name (Hand)",
  "away_starter": "Name (Hand)",
  "home_win_pct": integer,
  "away_win_pct": integer,
  "ou_line": "string",
  "ou_prediction": "OVER or UNDER — ALWAYS set, never PASS (§3.12)",
  "ou_confidence": "Low or Moderate or High or Lean",
  "ou_over_pct": integer,
  "ou_risk_level": "STANDARD or MODERATE RISK or HIGH RISK or EXTREME RISK",
  "ou_bet_eligible": "boolean — true=standard bet, false=lean only or no bet",
  "ou_bet_size": "$75 or $50 or $25 or $0",
  "confidence_score": integer,
  "confidence_deductions": ["PDCF: -30"],
  "active_flags": ["Surging (Home SP)", "Division Race (Away)", "PDCF"],
  "active_overrides": ["None or WP-Override A fired / OU-A fired"],
  "gvi": integer,
  "home_tms": number,
  "away_tms": number,
  "home_pms": integer,
  "away_pms": integer,
  "home_pvs": number,
  "away_pvs": number,
  "home_red": number,
  "away_red": number,
  "pdcf_active": boolean,
  "key_driver": "single most important factor phrase",
  "reasoning": "2-3 sentence plain-English summary",
  "ml_recommendation": "ML bet $75 — conf [X] in zone (60% historical) OR Pass — conf outside 50–64",
  "betting_recommendation": "combined ML + Under result e.g. ML $75 + Pattern B Under $75 OR Pass — reason",
  "betting_flags": {
    "flag1_conf_zone": "ELIGIBLE — conf X in 50–64 OR Pass — conf outside zone",
    "flag2_gate_a": "CLEAR — prev-day avg X.X OR BLOCKED — avg >10",
    "flag3_gate_b": "CLEAR OR BLOCKED — [team] scored X in win N days ago",
    "flag4_gate_c": "PASS — ERA X.XX / N starts OR FAIL",
    "flag5_gate_d": "PASS (ATH/WAS) OR FAIL ([visitor]) OR N/A (May+)",
    "flag6_gate_e": "PASS — corrected X.X≤6.5 OR FAIL — X.X>6.5",
    "flag7_april_bias": "temp-sensitive bias: +1.5/<50F / +2.5/50-64F / +3.0/65-74F / +3.5/>=75F / +4.0/>=85F or Apr1-14 / +2.0 May+",
    "flag8_rain_gate": "clear <65% OR halve 65-84% OR skip >=85%",
    "flag9_venue_ban": "clear OR ACTIVE — venue cold UNDER banned",
    "flag10_conf_cap": "clear OR P9_BAN conf>=65 OR P4_VETO road ace",
    "ml_bet_result": "Bet $75 OR Pass — reason",
    "under_bet_result": "Bet $[size] UNDER [line] OR Pass — Gate X failed: reason",
    "gates_passed": ["A","B","C","D","E"],
    "pattern_tier": "Pattern A or Pattern B or Strong Under or Standard or null"
  },
  "export_string": "Away @ Home,Home SP (HOME),Away SP (AWAY),52%,48%,7.5,61% (Over)",
  "data_sources": {
    "extracted_from_image": ["list of fields taken directly from image data"],
    "filled_from_knowledge": ["list of fields recalled from MLB knowledge base"],
    "estimated": ["list of fields that were estimated/derived"]
  }
}`;

const ALLOWED_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);

// ─── Verification: Extraction glitch checker ──────────────────────────────────
function verifyExtraction(data) {
  const issues = [];

  // Required identity fields
  if (!data.home_team || data.home_team.trim() === "") issues.push("home_team is missing");
  if (!data.away_team || data.away_team.trim() === "") issues.push("away_team is missing");
  if (!data.game_date || data.game_date === "YYYY-MM-DD") issues.push("game_date is missing or still a template value");
  if (!data.venue    || data.venue.trim() === "")         issues.push("venue is missing");

  // Starters
  const hSP = data.starters?.home;
  const aSP = data.starters?.away;
  if (!hSP?.name || hSP.name.trim() === "") issues.push("starters.home.name is missing");
  if (!aSP?.name || aSP.name.trim() === "") issues.push("starters.away.name is missing");

  // ERA / WHIP sanity — must be numeric and in plausible range
  const checkPitcher = (sp, side) => {
    const era = parseFloat(sp?.era);
    const whip = parseFloat(sp?.whip);
    if (sp?.name) {
      if (isNaN(era) || era === 0)          issues.push(`starters.${side}.era is zero or non-numeric`);
      else if (era > 15)                    issues.push(`starters.${side}.era is implausibly high (${era})`);
      if (isNaN(whip) || whip === 0)        issues.push(`starters.${side}.whip is zero or non-numeric`);
      else if (whip > 3.5)                  issues.push(`starters.${side}.whip is implausibly high (${whip})`);
      if (!sp.recent_games || sp.recent_games.length === 0)
                                            issues.push(`starters.${side}.recent_games is empty — need at least 1 start`);
    }
  };
  checkPitcher(hSP, "home");
  checkPitcher(aSP, "away");

  // Team stats
  const checkTeam = (ts, side, recordKey) => {
    if (!ts) { issues.push(`team_stats.${side} block is missing`); return; }
    const avg = parseFloat(ts.avg_runs);
    if (isNaN(avg) || avg === 0)            issues.push(`team_stats.${side}.avg_runs is zero or missing`);
    if (!ts[recordKey] || ts[recordKey].includes("XX"))
                                            issues.push(`team_stats.${side}.${recordKey} is missing`);
  };
  checkTeam(data.team_stats?.home, "home", "home_record");
  checkTeam(data.team_stats?.away, "away", "away_record");

  // Betting line
  const ou = parseFloat(data.betting?.over_under);
  if (isNaN(ou) || ou === 0)              issues.push("betting.over_under is missing or zero");

  return issues;
}

// ─── Verification: Prediction glitch checker ──────────────────────────────────
function verifyPrediction(data) {
  const issues = [];

  // Win probability sum and caps
  const hp = Number(data.home_win_pct);
  const ap = Number(data.away_win_pct);
  if (isNaN(hp) || isNaN(ap))             issues.push("home_win_pct or away_win_pct is not a number");
  else {
    if (Math.abs(hp + ap - 100) > 1)      issues.push(`home_win_pct (${hp}) + away_win_pct (${ap}) must sum to 100`);
    if (hp > 80 || ap > 80)               issues.push(`win probability exceeds 80% cap (home:${hp}%, away:${ap}%)`);
    if (hp < 20 || ap < 20)               issues.push(`win probability below 20% floor (home:${hp}%, away:${ap}%)`);
  }

  // Confidence score
  const conf = Number(data.confidence_score);
  if (isNaN(conf))                        issues.push("confidence_score is not a number");
  else if (conf < 25)                     issues.push(`confidence_score (${conf}) is below the minimum floor of 25`);
  else if (conf > 100)                    issues.push(`confidence_score (${conf}) exceeds 100`);

  // GVI range
  const gvi = Number(data.gvi);
  if (isNaN(gvi))                         issues.push("gvi is not a number");
  else if (gvi < 1 || gvi > 100)          issues.push(`gvi (${gvi}) is outside the valid range of 1–100`);

  // TMS range
  const htms = Number(data.home_tms);
  const atms = Number(data.away_tms);
  if (!isNaN(htms) && (htms < -14 || htms > 18)) issues.push(`home_tms (${htms}) is outside valid range -14 to +18`);
  if (!isNaN(atms) && (atms < -14 || atms > 18)) issues.push(`away_tms (${atms}) is outside valid range -14 to +18`);

  // O/U prediction vs over%
  const ouPred = data.ou_prediction;
  const ouPct  = Number(data.ou_over_pct);
  if (!["OVER","UNDER"].includes(ouPred))  issues.push(`ou_prediction must be OVER or UNDER, got: ${ouPred}`);
  if (!isNaN(ouPct)) {
    if (ouPred === "OVER"  && ouPct < 50)  issues.push(`ou_prediction is OVER but ou_over_pct (${ouPct}) is below 50% — inconsistent`);
    if (ouPred === "UNDER" && ouPct > 50)  issues.push(`ou_prediction is UNDER but ou_over_pct (${ouPct}) is above 50% — inconsistent`);
  }

  // Required output fields
  if (!data.ou_line)                       issues.push("ou_line is missing");
  if (!data.betting_recommendation)        issues.push("betting_recommendation is missing");
  if (!data.reasoning)                     issues.push("reasoning narrative is missing");
  if (!data.export_string)                 issues.push("export_string is missing");
  if (!data.season_type)                   issues.push("season_type is missing");

  // PMS range
  const hpms = Number(data.home_pms);
  const apms = Number(data.away_pms);
  if (!isNaN(hpms) && hpms < 100)         issues.push(`home_pms (${hpms}) is below the baseline of 100`);
  if (!isNaN(apms) && apms < 100)         issues.push(`away_pms (${apms}) is below the baseline of 100`);

  return issues;
}

const MAX_VERIFY_PASSES = 3;

// Wrap multer middleware so its errors are caught and returned as JSON with CORS headers
function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    upload.array("images", 10)(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function parseJsonResponse(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

// ─── Parse plain text / raw stats into structured JSON ───────────────────────
app.post("/api/parse-text", async (req, res) => {
  try {
    const { text, model: requestedModel } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "No text provided" });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured" });
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "claude-sonnet-4-6";
    const message = await client.messages.create({
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `The following is plain text or pasted game data for an MLB matchup. Extract all available fields into the exact JSON structure template below. Fill every field you can find in the text.\n\nTemplate:\n${JSON_TEMPLATE}\n\nGame data to parse:\n\n${text.trim()}`,
      }],
    });
    const rawText = message.content[0].text.trim();
    const parsed = parseJsonResponse(rawText);
    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error("Parse-text error:", err);
    if (err instanceof SyntaxError) res.status(500).json({ error: "Failed to parse AI response as JSON", detail: err.message });
    else res.status(500).json({ error: err.message || "Parse failed" });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    await runMulter(req, res);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured in .env file" });
    }

    const requestedModel = req.body.model;
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "claude-sonnet-4-6";

    // Check total payload size before sending to Claude
    const totalBytes = req.files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > 15 * 1024 * 1024) {
      return res.status(400).json({ error: `Total image size (${(totalBytes/1024/1024).toFixed(1)}MB) exceeds 15MB limit. Please use smaller or compressed screenshots.` });
    }

    // Build image content (reused across verify passes)
    const imageContent = [];
    for (const file of req.files) {
      imageContent.push({
        type: "image",
        source: { type: "base64", media_type: file.mimetype, data: file.buffer.toString("base64") },
      });
    }

    // ── Pass 1: initial extraction ──────────────────────────────────────────
    let messages = [{
      role: "user",
      content: [
        ...imageContent,
        { type: "text", text: `Analyze the MLB game image(s) above and extract all visible data into this exact JSON structure. Fill in every field you can see. Here is the template to follow:\n\n${JSON_TEMPLATE}` },
      ],
    }];

    let parsed, issues, pass = 0;

    while (pass < MAX_VERIFY_PASSES) {
      pass++;
      const message = await client.messages.create({ model, max_tokens: 8000, system: SYSTEM_PROMPT, messages });
      const rawText = message.content[0].text.trim();

      try {
        parsed = parseJsonResponse(rawText);
      } catch (e) {
        if (pass >= MAX_VERIFY_PASSES) throw new SyntaxError(`JSON parse failed after ${pass} passes: ${e.message}`);
        // Ask Claude to fix the invalid JSON
        messages = [
          ...messages,
          { role: "assistant", content: rawText },
          { role: "user",     content: `Your response was not valid JSON. Error: ${e.message}. Please return only valid JSON — no markdown, no preamble.` },
        ];
        continue;
      }

      issues = verifyExtraction(parsed);
      console.log(`[analyze] Pass ${pass} — ${issues.length} issue(s):`, issues);

      if (issues.length <= 1) break; // ≤1 glitch: accept

      if (pass < MAX_VERIFY_PASSES) {
        const fixList = issues.map((iss, i) => `${i + 1}. ${iss}`).join("\n");
        messages = [
          ...messages,
          { role: "assistant", content: rawText },
          {
            role: "user",
            content: `Your extraction has ${issues.length} issues that need correction. Fix ALL of them and return the corrected JSON:\n\n${fixList}\n\nReturn only the corrected JSON — no markdown, no explanation.`,
          },
        ];
      }
    }

    res.json({ success: true, data: parsed, verify: { passes: pass, remaining_issues: issues } });
  } catch (err) {
    console.error("Analysis error:", err);
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: "Failed to parse Claude response as JSON", detail: err.message });
    } else {
      res.status(500).json({ error: err.message || "Analysis failed" });
    }
  }
});

app.post("/api/predict", async (req, res) => {
  try {
    const { gameData, model: requestedModel, extraNotes } = req.body;

    if (!gameData) {
      return res.status(400).json({ error: "No game data provided" });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured in .env file" });
    }

    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "claude-opus-4-6";

    const notesBlock = extraNotes && extraNotes.trim()
      ? `\n\nADDITIONAL CONTEXT FROM USER (treat as high-priority scouting notes — incorporate into your analysis):\n${extraNotes.trim()}`
      : "";

    // ── Pass 1: initial prediction ──────────────────────────────────────────
    let messages = [{
      role: "user",
      content: `Apply the MLB Game Predictor v2.6 framework to this extracted game data. Fill any missing fields from your knowledge base first, then return the complete JSON prediction:\n\n${JSON.stringify(gameData, null, 2)}${notesBlock}`,
    }];

    let parsed, issues, pass = 0;

    while (pass < MAX_VERIFY_PASSES) {
      pass++;
      const message = await client.messages.create({ model, max_tokens: 8000, system: PREDICT_SYSTEM, messages });

      if (message.stop_reason === "max_tokens") {
        console.warn(`⚠️  Prediction pass ${pass} hit max_tokens limit`);
      }

      const rawText = message.content[0].text.trim();
      console.log(`[predict] Pass ${pass} raw (first 200):`, rawText.slice(0, 200));

      try {
        parsed = parseJsonResponse(rawText);
      } catch (e) {
        if (pass >= MAX_VERIFY_PASSES) throw new SyntaxError(`JSON parse failed after ${pass} passes: ${e.message}`);
        messages = [
          ...messages,
          { role: "assistant", content: rawText },
          { role: "user",     content: `Your response was not valid JSON. Error: ${e.message}. Return only valid JSON — no markdown, no preamble.` },
        ];
        continue;
      }

      issues = verifyPrediction(parsed);
      console.log(`[predict] Pass ${pass} — ${issues.length} issue(s):`, issues);

      if (issues.length <= 1) break; // ≤1 glitch: accept

      if (pass < MAX_VERIFY_PASSES) {
        const fixList = issues.map((iss, i) => `${i + 1}. ${iss}`).join("\n");
        messages = [
          ...messages,
          { role: "assistant", content: rawText },
          {
            role: "user",
            content: `Your prediction has ${issues.length} rule violations. Fix ALL of them and return the corrected JSON:\n\n${fixList}\n\nRemember: win probabilities must sum to 100, cap at 80/20, confidence floor is 25, GVI must be 1–100, TMS must be −14 to +18, OVER prediction requires ou_over_pct ≥ 50. Return only corrected JSON.`,
          },
        ];
      }
    }

    res.json({ success: true, data: parsed, verify: { passes: pass, remaining_issues: issues } });
  } catch (err) {
    console.error("Prediction error:", err.message);
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: "Failed to parse prediction response as JSON", detail: err.message });
    } else {
      res.status(500).json({ error: err.message || "Prediction failed" });
    }
  }
});

// ─── Save prediction to DB ────────────────────────────────────────────────────
app.post("/api/save-prediction", (req, res) => {
  try {
    const { prediction, game_date } = req.body;
    if (!prediction) return res.status(400).json({ error: "No prediction data provided" });

    const row = {
      saved_at:              new Date().toISOString(),
      game_date:             game_date || prediction.game_date || null,
      season_type:           prediction.season_type || null,
      home_team:             prediction.home_team || null,
      away_team:             prediction.away_team || null,
      home_starter:          prediction.home_starter || null,
      away_starter:          prediction.away_starter || null,
      home_win_pct:          prediction.home_win_pct ?? null,
      away_win_pct:          prediction.away_win_pct ?? null,
      ou_line:               prediction.ou_line || null,
      ou_prediction:         prediction.ou_prediction || null,
      ou_confidence:         prediction.ou_confidence || null,
      ou_over_pct:           prediction.ou_over_pct ?? null,
      confidence_score:      prediction.confidence_score ?? null,
      gvi:                   prediction.gvi ?? null,
      home_tms:              prediction.home_tms ?? null,
      away_tms:              prediction.away_tms ?? null,
      home_pms:              prediction.home_pms ?? null,
      away_pms:              prediction.away_pms ?? null,
      home_pvs:              prediction.home_pvs ?? null,
      away_pvs:              prediction.away_pvs ?? null,
      home_red:              prediction.home_red ?? null,
      away_red:              prediction.away_red ?? null,
      pdcf_active:           prediction.pdcf_active ? 1 : 0,
      active_flags:          JSON.stringify(prediction.active_flags || []),
      active_overrides:      JSON.stringify(prediction.active_overrides || []),
      betting_recommendation: prediction.betting_recommendation || null,
      key_driver:            prediction.key_driver || null,
      reasoning:             prediction.reasoning || null,
      export_string:         prediction.export_string || null,
      full_prediction:       JSON.stringify(prediction),
    };

    const info = insertPrediction.run(row);
    syncExportFile();
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error("Save prediction error:", err);
    res.status(500).json({ error: err.message || "Failed to save prediction" });
  }
});

// ─── Log actual game result ───────────────────────────────────────────────────
app.post("/api/result/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { actual_home_score, actual_away_score, notes } = req.body;

    if (isNaN(id)) return res.status(400).json({ error: "Invalid prediction ID" });
    if (actual_home_score == null || actual_away_score == null)
      return res.status(400).json({ error: "Both scores required" });

    const pred = db.prepare("SELECT * FROM predictions WHERE id = ?").get(id);
    if (!pred) return res.status(404).json({ error: "Prediction not found" });

    const homeScore = parseFloat(actual_home_score);
    const awayScore = parseFloat(actual_away_score);
    const total     = homeScore + awayScore;
    const actualWinner = homeScore > awayScore ? pred.home_team : pred.away_team;

    // Determine predicted winner
    const predictedWinner = pred.home_win_pct >= pred.away_win_pct ? pred.home_team : pred.away_team;
    const ml_correct = (actualWinner === predictedWinner) ? 1 : 0;

    // Determine O/U result
    const ouLine = parseFloat(pred.ou_line);
    let ou_result = null, ou_correct = null;
    if (!isNaN(ouLine)) {
      ou_result   = total > ouLine ? "OVER" : total < ouLine ? "UNDER" : "PUSH";
      ou_correct  = ou_result === "PUSH" ? null : (ou_result === pred.ou_prediction ? 1 : 0);
    }

    updateActualResult.run({
      id,
      actual_winner:     actualWinner,
      actual_home_score: homeScore,
      actual_away_score: awayScore,
      actual_total:      total,
      ml_result:         actualWinner === pred.home_team ? "HOME" : "AWAY",
      ou_result,
      ml_correct,
      ou_correct,
      notes: notes || null,
    });

    syncExportFile();
    res.json({ success: true, ml_correct, ou_correct, ou_result, actual_total: total });
  } catch (err) {
    console.error("Result error:", err);
    res.status(500).json({ error: err.message || "Failed to save result" });
  }
});

// ─── Sync export file after any DB write ─────────────────────────────────────
function syncExportFile() {
  try {
    const rows = db.prepare("SELECT * FROM predictions ORDER BY id ASC").all();
    const exportPath = path.join(__dirname, "predictions-export.json");
    require("fs").writeFileSync(exportPath, JSON.stringify(rows, null, 2));
  } catch (e) {
    console.warn("[DB] Export sync failed:", e.message);
  }
}

// ─── Get all predictions (paginated) ─────────────────────────────────────────
app.get("/api/predictions", (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || "1", 10));
    const limit = Math.min(100, parseInt(req.query.limit || "25", 10));
    const offset = (page - 1) * limit;

    const rows  = db.prepare("SELECT * FROM predictions ORDER BY saved_at DESC LIMIT ? OFFSET ?").all(limit, offset);
    const total = db.prepare("SELECT COUNT(*) as cnt FROM predictions").get().cnt;

    res.json({ success: true, data: rows, total, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TEMPORARY: Force-reseed from predictions-export.json (remove after use) ──
app.post("/api/force-reseed", (req, res) => {
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "predictions-export.json"), "utf8"));
    const insertRow = db.prepare(`
      INSERT OR IGNORE INTO predictions (
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
    `);
    const runAll = db.transaction((rows) => {
      let inserted = 0;
      for (const row of rows) insertRow.run(row) && inserted++;
      return inserted;
    });
    const inserted = runAll(rows);
    const total = db.prepare("SELECT COUNT(*) as n FROM predictions").get().n;
    res.json({ success: true, inserted, total, source_rows: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Flag performance stats ───────────────────────────────────────────────────
app.get("/api/flag-stats", (_req, res) => {
  try {
    const FLAG_DEFS = [
      // ── Rules R1–R14 ──────────────────────────────────────────────────────────
      { code:"R1_NO_SIGNAL",       label:"R1 · No O/U Signal",           desc:"Zero signal flags + no Slumping/Surging SP → O/U 16.3% (catastrophic). Hard stop — no direction output.", expected_ou:16.3, type:"rule" },
      { code:"R2_LINE_9_10",       label:"R2 · Line 9–10 OVER + Signal", desc:"OVER on 9.0–10.0 line with ≥1 active signal = elite zone. 68.8% hit rate (n=32). Highest-reliability mass-sample bet.", expected_ou:68.8, type:"rule", patterns:["R2","P12_OVER_SWEET","P12_over_sweet","line 9.0-10.0","line 9-10"] },
      { code:"R3_SINGLE_SIGNAL",   label:"R3 · Single Signal → ML only", desc:"Exactly 1 O/U signal active → bet ML only (75% ML). Skip O/U (37.5%). Single signal = directional ML clarity, not scoring certainty.", expected_ml:75.0, expected_ou:37.5, type:"rule" },
      { code:"R4_WPA",             label:"R4 · WP-Override A (Surging Ace vs Slumper)", desc:"Surging ace (RED<−1.0, xFIP<3.25) faces slumping opponent (RED>+1.5) → ML 63%. Always bet ML. O/U UNDER requires confirmed xFIP, not estimated.", expected_ml:63.0, type:"rule", patterns:["WP-Override A fired","R4_WPA","WPA fired"] },
      { code:"R5_PVS_OVER",        label:"R5 · PVS>15 [REVERSED v3.5]",  desc:"REVERSED: was 61.3% OVER signal — 294-game staked reality = 38–40% (below breakeven). Now a confidence suppressor only (−10 conf per pitcher). Do NOT route O/U on PVS alone.", expected_ou:38.0, type:"rule", patterns:["R5_PVS_OVER","R5_PVS_CONF","PVS>15","PVS >15"] },
      { code:"R6_UNDER_SWEET",     label:"R6 · UNDER Line 8.0–9.0",      desc:"Only viable UNDER line range. 60.5% hit rate (n=43). Below 8.0 = 34.5% (banned). Above 9.0 = sub-40% (banned). All 7 Under gates still required.", expected_ou:60.5, type:"rule", patterns:["R6","P15_UNDER_SWEET","P15_under_sweet","UNDER sweet spot","line 8.0-9.0","8.0-9.0"] },
      { code:"R7_GVI65",           label:"R7 · GVI≥65 OVER only",         desc:"GVI≥65 → O/U OVER 58.9%. ML = 50% coin flip (skip). UNDER = 0.0% (4/4 failure — hard ban). High GVI always amplifies scoring, never suppresses.", expected_ou:58.9, type:"rule" },
      { code:"MCF",                label:"R8 · MCF [UPGRADED TO ML BAN]", desc:"Model contradicts market = ML PROHIBITED. MCF ML = 50% coin flip (294-game). O/U still eligible if a signal exists. Prior 25% reduction was insufficient.", expected_ml:50.0, type:"rule", patterns:["MCF:","MCF ","Model Contradiction","R8_MCF"] },
      { code:"R9_WIND",            label:"R9 · Wind OUT",                 desc:"Standalone: OVER lean $25 (54–56% edge). With catalyst (PVS>15, Slumping SP, GVI>65): OVER $50 standard. Wind OUT alone is thin but real.", expected_ou:54.0, type:"rule", patterns:["R9_WIND_CATALYST","R9_WIND_LEAN","Wind OUT","wind out","blowing out","blowing OUT"] },
      { code:"R10_CONF_ZONE",      label:"R10 · Conf 60–64 [RETIRED]",    desc:"RETIRED (v3.5). Superseded by R12 extension to 55–65. Conf 60–64 is now inside the dead zone. Do not use as O/U sweet spot.", expected_ou:63.6, type:"rule", patterns:["R10_CONF_ZONE"] },
      { code:"R11_SLUMPING_SP",    label:"R11 · Slumping SP",             desc:"Either SP RED>+1.5 → O/U power signal +20pp accuracy. Away slumping: 62.5% (n=24). Home slumping: 61.9% (n=21). Independently justifies O/U bet.", expected_ou:62.0, type:"rule", patterns:["R11_SLUMPING_SP","Slumping.*SP","SP Slumping","SP.*slumping"] },
      { code:"R12_DEAD_ZONE",      label:"R12 · Conf 55–65 Dead Zone [Extended]", desc:"Extended from 55–60 to 55–65 (v3.5). O/U dead zone: 28–30% hit rate. Conf 60–65 elevated in wrong games (15.9% BW vs 6.5% BC). Output PASS — no O/U direction. ML still eligible.", expected_ou:28.0, type:"rule", patterns:["R12_DEAD_ZONE"] },
      { code:"PWF_MATCH",          label:"R13 · Platoon Weakness Flag",   desc:"Batting team 0-for-3+ vs SP handedness this season → ML 86% for pitcher's team. Highest alpha ML signal. Apply +8% WP. If PWF+WPA both fire = near-automatic ML.", expected_ml:86.0, type:"rule", patterns:["PWF_MATCH","Platoon Weakness","PWF"] },
      { code:"AWAY_ACE_OVERRIDE",  label:"R14 · Away Ace Override [NEW v3.5]", desc:"Away SP RED<−1.0 (surging) while model routes ML to home team → 9/9 failure. Apply −10% to home WP, flip ML to away. Surging away ace overrides all home-field adjustments.", expected_ml:100.0, type:"rule", patterns:["AWAY_ACE_OVERRIDE","Away SP surging","R14","away.*RED.*-1","surging away"] },
      // ── New v3.5 signals ──────────────────────────────────────────────────────
      { code:"SINGLE_RED_UNAV",    label:"Single SP RED_unavailable [NEW]", desc:"RED missing on EITHER SP → O/U PASS. 26.1% of both-wrong vs 4.8% both-correct games (−21.2% gap — most extreme of any flag). Flying blind = systematic wrong direction.", type:"rule", patterns:["SINGLE_RED_UNAV","RED_unavailable","RED unavailable","Early-Season RED Unreliable"] },
      { code:"GOLDEN_CONDITION",   label:"Golden Condition [NEW v3.5]",   desc:"OU-A + OU-B + RED mismatch >1.5 all fire → gap threshold drops to 1.5 runs. Appears in 42% of both-correct games. Triple signal = highest-quality bet setup.", type:"rule", patterns:["GOLDEN_CONDITION"] },
      { code:"TMS_OUA_TOXIC",      label:"TMS≥15 + OU-A Toxic Combo",     desc:"TMS diff≥15 AND OU-A fire together → halve O/U stake. NOT a double-confirmation. Appears in 20.3% of both-wrong vs 12.9% both-correct. Market has priced the momentum.", type:"rule", patterns:["TMS_OUA_TOXIC","TMS.*OU-A","TMS diff.*15"] },
      { code:"TMS_DIFF_BOOST",     label:"TMS Diff Boost [REMOVED v3.5]", desc:"REMOVED. Was +2% WP at TMS diff>15. 294-game reality: 50% ML (coin flip), 39% O/U (below breakeven). Do not apply any WP boost for TMS differential.", expected_ml:50.0, type:"flag", patterns:["TMS_DIFF_BOOST"] },
      // ── Additional confidence/context flags ───────────────────────────────────
      { code:"HVIF",               label:"HVIF · High Volatility Index",  desc:"GVI>75 → −15 confidence. High game-score variance environment. Combined with VMF (GVI>70 + WP 55–65%) for additional −10. Signals scoring unpredictability.", type:"flag", patterns:["HVIF","High Volatility Index","High-Volatility"] },
      { code:"BOTH_XFIP_BLIND",    label:"BOTH_XFIP_BLIND · Dual Estimated xFIP", desc:"Both SPs have estimated (not confirmed) xFIP AND both have <3 confirmed starts → suppress O/U direction entirely (38% accuracy). Stricter than BOTH_RED_UNAVAIL. Output Pass with no direction.", expected_ou:38.0, type:"flag", patterns:["BOTH_XFIP_BLIND","BOTH_xFIP_BLIND","BOTH_xFIP_ESTIMATED","BOTH_XFIP_ESTIMATED","Both xFIP","both.*xFIP.*estimated"] },
      { code:"NO_EDGE",            label:"No-Edge Pass (47–53% WP)",      desc:"Final home WP falls 47–53% after all adjustments → ML recommendation = Pass. Model has zero edge in close games (went 1-for-8 at 12.5% in this range). O/U still proceeds normally.", type:"flag", patterns:["NO-EDGE","NO_EDGE","No-edge","No-Edge","ml_edge=no-edge","ml_edge.*no-edge","NO_EDGE_PASS","ML_NO_EDGE","No-line.*edge"] },
      { code:"WIND_COLD_GATE",     label:"Wind-Cold Gate (cancelled)",    desc:"Wind blowing OUT + temperature <60°F → wind OVER bonus cancelled. Cold air kills ball carry. Fall through to OU-D/OU-E. All 4 prior wind-OVER misses were in cold weather.", type:"flag", patterns:["WIND-COLD","Wind-Cold","WIND_COLD","wind.*cold.*gate","Wind-Cold.*gate","WIND_COLD_GATE"] },
      { code:"HIGH_LINE_OVER_BAN", label:"HLOB · April High-Line OVER Ban", desc:"April game + O/U line ≥9.5 + OVER direction → PASS. OVER on ≥9.5 April lines = 36% hit rate. Market fully prices in the offence at extreme lines. −30 confidence.", type:"flag", patterns:["HIGH_LINE_OVER_BAN","HLOB","HIGH-LINE.*BAN","April.*line.*9.5.*OVER","line.*9.5.*ban"] },
      { code:"HIGH_LINE_LEAN",     label:"April High-Line OVER Lean",     desc:"April game + O/U line 9.0–9.4 → OVER lean (Low confidence). OVER on 9.0+ April lines = 64.3%. Exception: cancel if both SPs confirmed xFIP≤3.00.", type:"flag", patterns:["HIGH_LINE_LEAN","High-Line.*Lean","HIGH_LINE_LEAN","April.*line.*9.0.*OVER","line.*9.0.*lean","HIGH-LINE.*LEAN"] },
      { code:"UNDER_BAN_LOW",      label:"UNDER Ban (7.5–7.9 lines)",     desc:"April + O/U line 7.5–7.9 + UNDER direction → PASS. 27.3% hit rate (3/11), avg actual total 10.3 runs. Market price already reflects suppression; UNDER has zero additional edge.", type:"flag", patterns:["UNDER_BAN_7.5","UNDER_BAN_7","Under.*ban.*7.5","LOW-LINE.*BAN","Low-Line.*ban","under.*7.5.*ban"] },
      { code:"SWR",                label:"SWR · Significant Weather Risk", desc:"Precipitation ≥85% → skip bet (void risk). 65–84% → halve stake. −10 confidence. Revised from prior 40% threshold. LAD home factor: don't skip below 85% when LAD is home.", type:"flag", patterns:["SWR","Significant Weather Risk","Weather Risk","SWR_SKIP","Rain","Precipitation.*65","Precipitation.*85"] },
      { code:"KXF",                label:"KXF · Knowledge xFIP Primary",  desc:"UNDER call primarily driven by knowledge-estimated xFIP (not confirmed from current-season logs) → −10 confidence. Estimated xFIP cannot drive High O/U confidence — capped at Moderate.", type:"flag", patterns:["KXF","Knowledge xFIP","knowledge.*xFIP","xFIP_estimated","xFIP.*estimated"] },
      { code:"COORS_OVER_GATE",    label:"Coors OVER Gate",               desc:"Coors Field (COL home): OVER lean only valid when BOTH teams avg_runs ≥3.5 over last 10 games. Either team <3.5 → no Coors OVER (52% = no edge). Prevents reflexive altitude OVER bets.", type:"flag", patterns:["COORS_OVER_GATE","Coors.*gate","COORS.*GATE","Coors.*OVER.*gate"] },
      { code:"WRIGLEY_UNCONF",     label:"WRIGLEY_UNCONF · Wrigley Wind", desc:"Wrigley Field game + wind-based OU-B signal + direction unconfirmed/variable → downgrade OU-B to OU-D input only. Wrigley wind notoriously inconsistent; require real-time confirmation.", type:"flag", patterns:["WRIGLEY_UNCONF","Wrigley.*unconf","Wrigley.*variable","WRIGLEY"] },
      { code:"RCF_SLUMPING",       label:"RCF+Slumping OVER Combo",       desc:"RCF active + same SP also Slumping (RED>+1.5) → strong OVER signal (65%, n=17). Pitcher simultaneously overperforming true level AND trending down — double vulnerability. Escalates to Moderate OVER.", expected_ou:65.0, type:"flag", patterns:["RCF+SLUMPING","RCF.*Slumping","RCF.*slumping","RCF+Slump"] },
      { code:"GVI_DEAD_ZONE",      label:"GVI Dead Zone (35–65)",         desc:"GVI falls 35–65 → PASS O/U (51% hit rate = no edge). Only override with primary signal: P10≤6.5, RCF+Slumping (65%), or Wind OUT>15mph (78%). Do not bet O/U on GVI alone in this range.", type:"flag", patterns:["GVI_DEAD_ZONE","GVI.*dead.*zone","GVI.*35.*65","GVI Dead Zone","Dead Zone"] },
      { code:"BOTH_RED_UNAVAIL",   label:"BOTH_RED_UNAVAIL · Both SPs <3 Starts", desc:"Both SPs have <3 confirmed starts → O/U 38% accuracy across 22 games (well below breakeven). Pass all O/U bets. Exception: P10 (bias-corrected projected total ≤6.5) may still fire.", expected_ou:38.0, type:"flag", patterns:["BOTH_RED_UNAVAIL","BOTH_RED_UNAVAILABLE","Both.*RED.*unavail","both.*SPs.*3 starts","BRU"] },
      { code:"H2H_ADJ",            label:"H2H Adjustment",                desc:"One team holds ≥65% H2H win rate over last 3 seasons → +3% win probability to that team. Applied in Step 1 of §4 alongside TMS, PMS, and defensive adjustments.", type:"flag", patterns:["H2H","Head-to-Head"] },
      // ── April calibration flags ───────────────────────────────────────────────
      { code:"APRIL_OU_GATE",      label:"April O/U Gate (Moderate Cap)", desc:"Game date April 1–30 → ALL O/U confidence capped at Moderate. High O/U in April was 47.1% vs Moderate at 61.5%. Exception: SLUMP+HEAT+PARK combo overrides. This gate fires AFTER direction is determined.", type:"flag", patterns:["April O/U Gate","april_ou_gate","April_OU_Gate","April Game.*O/U Gate"] },
      { code:"XFIP_ESTIM_GATE",   label:"xFIP Estimation Gate",          desc:"Pitcher xFIP is knowledge-estimated (not confirmed from current-season logs) → O/U confidence capped at Moderate. Both SPs estimated = Combined Estimation Cap → forces Moderate regardless of GVI.", type:"flag", patterns:["xFIP Estimation Gate","xFIP_ESTIMATION_GATE","xFIP Estimation","xFIP.*estimated.*Moderate","both xFIP.*estimated","both.*xFIP.*Moderate"] },
      { code:"APRIL_BASELINE",     label:"April Home/Away Baseline",      desc:"April 1–14: 48% home / 52% away baseline (Tier A). April 15–30: 49% home / 51% away (Tier B). Away teams won 58% empirically in April — home field bonus reduced or eliminated.", type:"flag", patterns:["April 1-14 baseline","April 15-30 baseline","April baseline","48% home","49% home","Tier A","Tier B"] },
      { code:"APRIL_BIAS_CORR",    label:"April Bias Correction",         desc:"April projected total inflated by temperature-sensitive bias: <50°F=+1.5, 50-64°F=+2.5, 65-74°F=+3.0, ≥75°F=+3.5, ≥85°F=+4.0; April 1-14 always +4.0. Applied before the ≥2.0 run gap gate.", type:"flag", patterns:["April Bias Correction","April bias","Bias Correction","bias correction","Corrected projected","corrected_projected"] },
      { code:"DIVISIONAL_RIVALRY", label:"Divisional Rivalry",            desc:"Teams are division rivals → +15 PMS to both teams. Increases motivational stakes for both sides. Applies in both Regular Season and Postseason.", type:"flag", patterns:["Divisional Rivalry","divisional rivalry","Division Rivalry","NL East","NL West","NL Central","AL East","AL West","AL Central"] },
      { code:"DH_G2",              label:"DH G2 · Doubleheader Game 2",   desc:"Game is the second game of a doubleheader → +8 GVI, OVER lean applied, UNDER never recommended. Tired bullpens in DH G2 give up more runs. Starter length doesn't suppress runs — liability shifts.", type:"flag", patterns:["DH G2","DH_G2","Doubleheader Game 2","doubleheader","DH-G2"] },
      { code:"GATE_D_FAIL",        label:"Gate D Fail (April Visitor)",   desc:"Gate D (April visitor filter): visiting team is NOT ATH (Oakland) or WAS (Washington) → Under bet blocked in April. Only these two specific weaker offences qualify for April Under bets.", type:"flag", patterns:["Gate D (April)","GATE_D_FAIL","Gate D.*NOT ATH","Gate D.*visitor","gate_d=false","gate_d.*fail","Gate_D_FAIL"] },
      { code:"HOS_GATE0",          label:"Gate 0 · Home Surge Veto",      desc:"Home team avg_runs ≥6.0 over last 3 games → VETO ALL Under bets. 0% Under hit rate (4/4 cases, 113-game data). Hard stop regardless of pitcher quality. Fires before Gate A.", type:"flag", patterns:["Gate 0 VETO","GATE_0","Gate 0","HOS","Home Offensive Surge","home.*avg_runs.*6","avg_runs.*6.0","gate_0_fail","Gate_0_FAIL"] },
      { code:"SURGING_SP",         label:"Surging SP (RED <−1.0)",        desc:"Either SP is Surging (RED<−1.0): recent ERA significantly better than season ERA. Triggers WP-Override A when facing a Slumping opponent. AWAY_ACE_OVERRIDE fires when surging SP is on the away team.", type:"flag", patterns:["Surging (Home SP","Surging (Away SP","Home SP.*Surging","Away SP.*Surging","SURGE-H","SURGE-A","Surging.*RED","RED.*-1.0","surging.*home","surging.*away"] },
      { code:"WRIGLEY_WIND_GATE",  label:"Wrigley Wind Confirmation",     desc:"Wrigley Field (CHC home) game + wind-based OU-B signal + wind direction unconfirmed or variable → downgrade OU-B to OU-D input only. Wrigley wind notoriously inconsistent; real-time confirmation required.", type:"flag", patterns:["WRIGLEY_UNCONF","Wrigley.*unconf","Wrigley.*variable","WRIGLEY","Wrigley Field"] },
      { code:"BOTH_LHP_FLAG",      label:"Both LHP Matchup",              desc:"Both starting pitchers are left-handed. Routes to P22 (UNDER 80%) if model calls UNDER, or P23 (OVER banned, 50% coin flip) if model calls OVER. Dual-LHP creates genuine scoring suppression dynamic.", type:"flag", patterns:["BOTH_LHP","Both LHP","both.*LHP","dual.*LHP","Both starting pitchers.*left","both.*left-handed"] },
      { code:"VMF_FLAG",           label:"VMF · Volatile Moderate Fav.",  desc:"GVI>70 AND final win probability 55–65% → −10 confidence. High game-score variance undermines moderate favorites — the model may be wrong despite a clear edge. Signals elevated uncertainty.", type:"flag", patterns:["VMF","Volatile Moderate","volatile.*moderate"] },
      { code:"AOP_REMOVED",        label:"AOP · April OVER Deduction [REMOVED]", desc:"April OVER pick deduction REMOVED at v3.1. April OVER is now 59.4% (not 40%). This flag is historic — no longer applied.", type:"flag", patterns:["AOP","April OVER Pick","April Over Pick"] },
      { code:"HSGV_FLAG",          label:"HSGV · High-Stakes Game",       desc:"Postseason elimination game OR both teams within 1 game of division/WC cutoff → −15 confidence. Replaces the postseason-only EGV from v1.0. High-pressure situations increase variance.", type:"flag", patterns:["HSGV","High-Stakes Game","high-stakes game","High Stakes"] },
      { code:"AWAY_WIN_AMP",       label:"Away Momentum Amplifier",       desc:"Away team TMS leads by 5+ pts AND no WP-Override active → additional +2% away WP (total +6% away TMS bonus before home offsets). Amplifies away form when momentum gap is significant.", type:"flag", patterns:["Away Momentum Amplifier","AWAY_MOMENTUM_AMPLIFIER","Away Momentum","away.*momentum.*amplifier"] },
      { code:"HVOL_H",             label:"HVOL-H · High Volatility Home SP", desc:"Home SP PVS>15 (game score std dev across last 5 starts) → −10 confidence. High-variance pitcher: more likely to implode OR dominate. Never bet UNDER with PVS>15. Not the same as DHVP (which requires both SPs).", type:"flag", patterns:["Home PVS","home SP)","(home SP)","PVS_home","PVS_HOME","HVOL-H","PVS_FLAG: Home","PVS FLAG (Home","PVS>15 Home","high variance home SP","volatile home SP","PVS_HIGH: Home","Home SP)*","PVS>15: E.","PVS>15 Home SP"] },
      { code:"HVOL_A",             label:"HVOL-A · High Volatility Away SP", desc:"Away SP PVS>15 (game score std dev across last 5 starts) → −10 confidence. High-variance pitcher: more likely to implode OR dominate. Never bet UNDER with PVS>15. Not the same as DHVP (which requires both SPs).", type:"flag", patterns:["Away PVS","away SP)","(away SP)","PVS_away","PVS_AWAY","HVOL-A","PVS_FLAG: Away","PVS FLAG (Away","PVS>15 Away","high variance away SP","volatile away SP","Away PVS flag","Away PVS Flag","PVS>15 Away SP"] },
      { code:"SLUMP_H",            label:"SLUMP-H · Slumping Home SP",       desc:"Home SP RED>+1.5 (recent ERA worse than season ERA). Triggers R11 O/U power signal (+20pp accuracy to 62%+). Also triggers RCF+Slumping OVER combo when RCF also active. OU-A Condition 1 fires when facing surging away SP.", type:"flag", patterns:["Slumping (Home SP","Slumping (Home","Home SP Slumping","Home SP.*Slump","SLUMP-H","SLUMP_H","slumping home SP","Slumping: Home","Slumping.*Home SP"] },
      { code:"SLUMP_A",            label:"SLUMP-A · Slumping Away SP",       desc:"Away SP RED>+1.5 (recent ERA worse than season ERA). Triggers R11 O/U power signal (+20pp accuracy to 62%+). Away SP slumping slightly more predictive than home SP slumping (62.5% vs 61.9%). Check R14 AWAY_ACE_OVERRIDE if also surging.", type:"flag", patterns:["Slumping (Away SP","Slumping (Away","Away SP Slumping","SLUMP-A","SLUMP_A","slumping away SP","Slumping: Away","Slumping.*Away SP"] },
      { code:"FORTRESS",           label:"FORTRESS · Home Fortress Flag",    desc:"Home team win% ≥.650 (or ≥.700 in April) → triggers Driver 2 Venue Control +5% home WP. May trigger WP-Override B if visiting team road win%<.500. FORTRESS+TMF combo (away team on losing streak) = 73% Under hit rate.", type:"flag", patterns:["Home Fortress","FORTRESS","home.*fortress","fortress.*flag","Home Fortress Flag"] },
      { code:"P9_BAN_FLAG",        label:"P9_BAN · High Confidence Cap",     desc:"O/U confidence ≥65 → capped to 64 for O/U betting (25% hit rate at 65+). P9 applies to O/U bets ONLY. ML bets at conf 65–69 remain eligible at $75 (66.7% ML hit rate at this zone).", type:"flag", patterns:["P9_BAN","P9_high_confidence_cap","P9_HIGH_CONF_CAP","P9_ban","conf.*65.*cap","High Confidence Cap","P9"] },
      // ── Patterns P1–P26 ───────────────────────────────────────────────────────
      { code:"P1_MATCH",           label:"P1 · Dome + Dual Elite SP",     desc:"Indoor/dome + both SPs xFIP≤3.25 (or ERA≤2.80) + 4+ starts + ≥20 IP → Pattern A Under. 67% hit rate. All 7 gates still required.", expected_ou:67.0, type:"pattern", patterns:["P1_MATCH","P1_dome_dual_ace","Dome.*dual"] },
      { code:"P2_MATCH",           label:"P2 · Home Ace vs ATH/WAS",      desc:"Home SP ERA<2.50 + 4+ starts + ≥20 IP AND visiting team is ATH or WAS (April only) → Pattern B Under $75. ~67% hit rate. April only, specific visitors only.", expected_ou:67.0, type:"pattern", patterns:["P2_MATCH","P2_home_ace","home ace.*ATH","home ace.*WAS"] },
      { code:"P3_SUSPENDED",       label:"P3 · Cold Natural Grass [SUSPENDED]", desc:"Temp<45°F + natural grass + no wind OUT. SUSPENDED — 33% hit rate. Informational only until May retest.", expected_ou:33.0, type:"pattern", patterns:["P3_SUSPENDED","P3_cold_natural","Cold natural grass"] },
      { code:"P4_ROAD_ACE",        label:"P4 · Road Ace VETO",            desc:"Away SP xFIP≤3.25 on road → UNDER banned. ML still eligible. Exception: both SPs xFIP≤3.25 + Gate C met → route to P1/P2 instead.", type:"pattern", patterns:["P4_ROAD_ACE_VETO","P4_VETO","P4_road_ace","Road Ace.*BAN","road ace.*veto"] },
      { code:"P7_SKIP",            label:"P7 · Hot Batting Team HARD SKIP", desc:"Either team avg_runs≥5.0 AND 3+ win streak → HARD SKIP warning. 14% hit rate historically (−38.7% ROI). Do not auto-bet. Requires user confirmation.", expected_ou:14.0, type:"pattern", patterns:["P7_SKIP","P7_hot_batting","hot.*batting.*SKIP","HARD SKIP"] },
      { code:"P8_BAN",             label:"P8 · Venue UNDER Ban",           desc:"Target/Progressive Field (cold <55°F) or NYY home (April) or PIT home (any O/U) → permanently banned. 0–22% hit rate in qualifying games.", type:"pattern", patterns:["P8_BAN","P8_venue","Venue.*ban","venue.*cold.*UNDER","Target Field","Progressive Field","PNC Park"] },
      { code:"P10_MATCH",          label:"P10 · Projected Total ≤6.5",    desc:"Corrected projected total ≤6.5 + UNDER direction → Strong UNDER signal. 74% hit rate (n=23). Gap threshold drops to 1.5 runs. Stake hard-capped at $50.", expected_ou:74.0, type:"pattern", patterns:["P10_MATCH","P10_projected","projected.*≤6.5","projected.*6.5","total.*6.5"] },
      { code:"P11_LAD_ACE",        label:"P11 · LAD Home Ace",            desc:"Dodger Stadium + Ohtani/Yamamoto/Sasaki + Gate C (ERA<2.50 + 4+ starts + ≥20 IP) → Pattern C Under $100. 80% hit rate (n=5). Highest-conviction Under signal.", expected_ou:80.0, type:"pattern", patterns:["P11_LAD_ACE","P11_lad_ace","LAD home.*Ohtani","LAD home.*Yamamoto","LAD home.*Sasaki"] },
      { code:"P12_OVER_SWEET",     label:"P12 · Line 9.0–10.0 OVER",     desc:"Pattern D OVER $75. 65.2% hit rate (n=23). Requires ≥1 scoring catalyst. Cancel if both SPs confirmed xFIP≤3.00.", expected_ou:65.2, type:"pattern", patterns:["P12_OVER_SWEET","P12_over_sweet","Pattern D"] },
      { code:"P13_OVER_HIGH",      label:"P13 · Line 10.0–12.0 OVER",    desc:"Pattern E OVER $50. 80% hit rate (n=5 small sample). High-line OVER confirmation. Requires Moderate confidence + primary signal.", expected_ou:80.0, type:"pattern", patterns:["P13_OVER_HIGH","P13_over_high","Pattern E"] },
      { code:"P14_OVER_LOW",       label:"P14 · Line 7.0–8.0 OVER",      desc:"Pattern F OVER $50. 61.5% hit rate (n=13). Low-line fade-the-book OVER. Requires ≥1 catalyst (wind/slumping SP/hot offence). OVER only — UNDER on 7–8 lines = 29.2% (banned).", expected_ou:61.5, type:"pattern", patterns:["P14_OVER_LOW","P14_over_low","Pattern F"] },
      { code:"P15_UNDER_SWEET",    label:"P15 · UNDER Line 8.0–9.0",     desc:"UNDER sweet spot. 57.5% hit rate (n=40). Only UNDER line range above breakeven. All 7 gates required. Moderate confidence only — never High.", expected_ou:57.5, type:"pattern", patterns:["P15_UNDER_SWEET","P15_under_sweet","UNDER.*sweet","Pattern.*Under.*8"] },
      { code:"P16_HOME_WP70",      label:"P16 · Home WP ≥70% ML",        desc:"Home WP≥70% after all adjustments → ML home unconditional. 85.7% hit rate (n=7). Highest ML signal. Do not use O/U in same games.", expected_ml:85.7, type:"pattern", patterns:["P16_HOME_WP70","P16_home_wp","Home WP.*70","WP.*70%"] },
      { code:"P17_HOME_WP65",      label:"P17 · Home WP 65–69% ML",      desc:"Home WP 65–69% → ML home primary. 68.8% hit rate (n=16). Strong structural advantage.", expected_ml:68.8, type:"pattern", patterns:["P17_HOME_WP65","P17_home_wp","Home WP.*65","WP.*65%"] },
      { code:"P18_WAS_HOME_OVER",  label:"P18 · WAS Home OVER",          desc:"Nationals Park home games → Pattern G OVER $75. 100% hit rate (n=4), avg 12.2 runs. Always apply OVER bias for WAS home.", expected_ou:100.0, type:"pattern", patterns:["P18_WAS_HOME_OVER","P18_was_home","WAS home","Nationals Park","Pattern G"] },
      { code:"P19_PIT_HOME",       label:"P19 · PIT Home O/U Ban",       desc:"PNC Park any O/U direction → permanently banned. 0% hit rate (0/4). Wind creates extreme variance (totals 2–21). ML PIT home still eligible.", expected_ou:0.0, type:"pattern", patterns:["P19_PIT_HOME_SKIP","P19_pit","PNC Park","PIT home.*O/U","PIT.*banned"] },
      { code:"P20_DOME_OVER",      label:"P20 · Dome OVER",              desc:"Dome/indoor stadium + OVER signal → valid. 67% hit rate (n=9). Dome eliminates weather suppression. OVER bias is clear in controlled environments.", expected_ou:67.0, type:"pattern", patterns:["P20_DOME_OVER","P20_dome_over","Dome.*OVER","dome.*over"] },
      { code:"P21_DOME_UNDER_BAN", label:"P21 · Dome UNDER Ban",         desc:"Dome + UNDER (without dual confirmed ace) → banned. 37% hit rate (n=27). No weather floor to support UNDER. Exception: both SPs ≥4 starts + ERA<2.50 → route to P1.", expected_ou:37.0, type:"pattern", patterns:["P21_DOME_UNDER_BAN","P21_dome_under","Dome.*UNDER.*ban","dome under.*ban"] },
      { code:"P22_DUAL_LHP_UNDER", label:"P22 · Both LHP → UNDER",       desc:"Both SPs left-handed + UNDER direction → 80% hit rate (n=5). LHP matchups create genuine scoring suppression. Always weight UNDER 80:20 when both LHP.", expected_ou:80.0, type:"pattern", patterns:["P22_DUAL_LHP_UNDER","P22_dual_lhp","Both LHP.*UNDER","dual.*LHP.*under"] },
      { code:"P23_DUAL_LHP_OBan",  label:"P23 · Both LHP OVER Ban",      desc:"Both SPs left-handed + OVER → banned. 50% hit rate (coin flip). LHP suppression neutralises the OVER signal. Route to UNDER or Pass.", expected_ou:50.0, type:"pattern", patterns:["P23_DUAL_LHP_OVER_BAN","P23_dual_lhp","Both LHP.*OVER.*ban","dual.*LHP.*over.*ban"] },
      { code:"P24_ACE_HOME_UNDER", label:"P24 · Named Ace Home UNDER",   desc:"Home SP is a named ace (Ohtani/Yamamoto/Sale/Castillo/Woo/Kirby/Skubal/Fried/Gray/Gallen/Webb/Senga/Nola/Imanaga/Keller) + Gate C met → Pattern H Under $75. 100% hit rate (n=10).", expected_ou:100.0, type:"pattern", patterns:["P24_ACE_HOME_UNDER","P24_ace_home","Pattern H"] },
      { code:"P25_HOU_HOME_OVER",  label:"P25 · HOU Home OVER",          desc:"Minute Maid Park home games → OVER bias. ~75% hit rate (n=8), avg 12.1 runs. Arrighetti/Burrows/Imai allowing many runs early 2026.", expected_ou:75.0, type:"pattern", patterns:["P25_HOU_HOME_OVER","P25_hou","HOU home","Minute Maid"] },
      { code:"P26_INVERSION_DAY",  label:"P26 · Inversion Day",          desc:"Prev-day ML<40% + O/U>70% → reduce ML to $37.50, concentrate O/U at full unit. Conditions favour scoring volatility but not directional certainty.", type:"pattern", patterns:["P26_INVERSION_DAY","P26_inversion","Inversion day"] },
      // ── Overrides & amplifiers ────────────────────────────────────────────────
      { code:"WP_OVERRIDE_B",      label:"WP-Override B [DOWNGRADED]",   desc:"Home Fortress vs poor road team → +5% home WP (reduced from +10%). External validation n=87 at 47% ML. Weak secondary signal only. Never primary ML driver.", expected_ml:47.0, type:"flag", patterns:["WP-Override B fired","WP-Override B","WPOvr-B","WPB"] },
      { code:"AWAY_MOM_AMP",       label:"Away Momentum Amplifier",      desc:"Away TMS leads by 5+ pts and no WP-Override → additional +2% away WP (total +6%). Amplifies away form when momentum gap is significant.", type:"flag", patterns:["AWAY_MOM","Away TMS"] },
      { code:"FTMF",               label:"FORTRESS+TMF Combo",           desc:"Home Fortress (home win%≥.650) + away team 5+ loss streak → secondary Under confirmation. 73% Under hit rate (n=8). Escalates Under confidence to Moderate if currently Low.", expected_ou:73.0, type:"flag", patterns:["FTMF","FORTRESS+TMF","Fortress.*TMF","TMF.*Fortress"] },
      { code:"RCF",                label:"RCF · Regression Candidate",   desc:"SP xFIP exceeds ERA by ≥1.20 → substitute xFIP for ERA downstream. RCF+Slumping = strong OVER signal (65%, n=17). RCF alone = ML edge (+2.4% vs baseline).", expected_ml:58.0, type:"flag", patterns:["RCF","Regression Risk","Regression Candidate"] },
      { code:"PDCF",               label:"PDCF · Primary Driver Conflict", desc:"Away team TMS-favored AND home team has Home Fortress → conflict protocol triggers. Apply tiebreaker hierarchy: bullpen xFIP diff → platoon advantage → RISP → home default.", type:"flag", patterns:["PDCF","Primary Driver Conflict"] },
      { code:"HFCF",               label:"HFCF · Heavy Favorite Caution", desc:"Either team win probability ≥68% → −20 confidence deduction. High WP may reflect genuine edge (P16/P17) or overfit stacking. Confidence penalised to reflect uncertainty.", type:"flag", patterns:["HFCF","Heavy Favorite"] },
      { code:"TMF",                label:"TMF · Team Meltdown",          desc:"Either team on 5+ consecutive losses → −20 confidence. Away TMF: −3% home WP. Home TMF: −5% home WP. Desperate team may regress to mean.", type:"flag", patterns:["TMF ","TMF:","Team Meltdown"] },
      { code:"COLD_HAMMER",        label:"Cold Hammer Override",         desc:"Temp<50°F + wind≥15mph → Strong UNDER hard override (81% hit rate). Fires before OU-A. Still subject to Gates 0/A/C/E and venue bans.", expected_ou:81.0, type:"flag", patterns:["COLD_HAMMER","Cold Hammer"] },
      { code:"SLUMP_HEAT_PARK",    label:"Slump+Heat+Park OVER",        desc:"Home SP Slumping (RED>+1.5) + temp≥75°F + hitter park → Strong/High OVER (87% hit rate). Overrides April High confidence cap. Structural OVER condition.", expected_ou:87.0, type:"flag", patterns:["SLUMP+HEAT+PARK","SLUMP.*HEAT.*PARK","slump.*heat.*park"] },
      { code:"DHVP",               label:"DHVP · Dual PVS>15",          desc:"Both SPs PVS>15 → O/U accuracy 41%. Skip O/U unless primary signal (P10, RCF+Slumping, Wind OUT>15mph). Single PVS>15 still adds −10 conf but doesn't block.", expected_ou:41.0, type:"flag", patterns:["DHVP:","DHVP ","Dual PVS","both SPs PVS","both.*PVS.*15"] },
      { code:"BSS",                label:"BSS · Both SPs Slumping",      desc:"Combined RED (homeRED + awayRED) >+1.0 when both trending slumping → Lean OVER + WP equalize −8%. BSS fires only at line ≤8.5; line>9.0 = market priced it (41%).", type:"flag", patterns:["BSS:","BSS ","Both SP Slumping","Both SPs Slumping","both.*slumping"] },
      { code:"BSS_LINE_CAP",       label:"BSS Line Cap (>9.0 suppressed)", desc:"BSS OVER fires but line>9.0 → market has already priced pitching volatility. BSS edge disappears at high lines (41% hit rate). Apply −20 confidence, cap at PASS.", expected_ou:41.0, type:"flag", patterns:["BSS_LINE_CAP","BSS.*line.*cap","BSS.*line.*9"] },
      { code:"WARM_VETO",          label:"WARM_VETO · Heat Under Gate",  desc:"Temp≥85°F + UNDER direction + GVI≥25 → UNDER veto. Under hit rate at ≥85°F = 31%. Requires GVI<25 to proceed with UNDER in hot weather.", type:"flag", patterns:["WARM_VETO","Warm.*veto","temp.*85.*UNDER"] },
      { code:"GVI_UNDER_BAN",      label:"GVI<35 UNDER BAN [PRE-GATE]", desc:"GVI<35 + UNDER direction → pre-gate hard ban. 294-game: 7/7 = 100% failure, avg actual 13.7 runs. The most dangerous rule in the system. GVI<35 may only suggest OVER or PASS.", expected_ou:0.0, type:"flag", patterns:["GVI<35_UNDER_BAN","GVI<35","GVI.*35.*UNDER.*ban"] },
      // ── Confidence deductions ─────────────────────────────────────────────────
      { code:"ESDU",               label:"ESDU · Early Season Data Unreliable", desc:"Early season game + ≥2 fields estimated from knowledge base → −10 confidence. Correlates with 65% OVER rate in April. Gate F halves Under stake when active.", type:"flag", patterns:["ESDU","Early Season Data Unreliable"] },
      { code:"KHA",                label:"KHA · Knowledge-Heavy April",  desc:"April game + ≥3 pitcher stats from knowledge (not confirmed) → −15 confidence. Degraded model reliability when operating on estimated data early in season.", type:"flag", patterns:["KHA","Knowledge.*Heavy","knowledge.*heavy.*April"] },
      { code:"AHP",                label:"AHP · April Home Pick",        desc:"Home team predicted winner in April → −8 confidence. Empirical: home picks correct only 42% of the time in April. Away teams won 58% empirically.", type:"flag", patterns:["AHP","April Home Pick"] },
      { code:"RED_THIN",           label:"RED Thin Sample (3–5 starts)",  desc:"SP has 3–5 starts → RED blended at 0.5 weight (RED × 0.5 + PVS_direction × 0.5). −5 confidence. Directional signal retained but reliability reduced vs 6+ start sample.", type:"flag", patterns:["RED_THIN","RED_thin","RED.*thin","3-5 starts","3–5 starts"] },
    ];

    const rows = db.prepare(
      "SELECT active_flags, ml_correct, ou_correct FROM predictions WHERE active_flags IS NOT NULL"
    ).all();

    const parseFlags = (raw) => {
      try { return Array.isArray(raw) ? raw : JSON.parse(raw); }
      catch { return typeof raw === "string" ? [raw] : []; }
    };

    const results = FLAG_DEFS.map(def => {
      const searchTerms = def.patterns || [def.code];
      let triggered = 0, ml_wins = 0, ml_graded = 0, ou_wins = 0, ou_graded = 0;
      for (const row of rows) {
        const flags = parseFlags(row.active_flags);
        const text  = flags.join(" ");
        if (!searchTerms.some(t => text.includes(t))) continue;
        triggered++;
        if (row.ml_correct !== null && row.ml_correct !== undefined) { ml_graded++; ml_wins += +row.ml_correct; }
        if (row.ou_correct !== null && row.ou_correct !== undefined) { ou_graded++; ou_wins += +row.ou_correct; }
      }
      return {
        code:        def.code,
        label:       def.label,
        desc:        def.desc,
        type:        def.type,
        triggered,
        ml_graded,
        ml_accuracy: ml_graded >= 3 ? +(ml_wins / ml_graded * 100).toFixed(1) : null,
        ou_graded,
        ou_accuracy: ou_graded >= 3 ? +(ou_wins / ou_graded * 100).toFixed(1) : null,
        expected_ml: def.expected_ml ?? null,
        expected_ou: def.expected_ou ?? null,
      };
    });

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Export all predictions (used by sync-from-railway.js pre-commit) ─────────
app.get("/api/export-all", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM predictions ORDER BY id ASC").all();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Accuracy stats ───────────────────────────────────────────────────────────
app.get("/api/stats", (_req, res) => {
  try {
    const total    = db.prepare("SELECT COUNT(*) as n FROM predictions").get().n;
    const graded   = db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ml_correct IS NOT NULL").get().n;
    const mlWins   = db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ml_correct = 1").get().n;
    const ouGraded = db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ou_correct IS NOT NULL").get().n;
    const ouWins   = db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ou_correct = 1").get().n;

    // Accuracy by confidence tier (use subquery to avoid GROUP BY alias issue in SQLite)
    const byTier = db.prepare(`
      SELECT tier,
             COUNT(*) as total,
             SUM(ml_correct) as ml_wins,
             SUM(CASE WHEN ou_correct IS NOT NULL THEN 1 ELSE 0 END) as ou_graded,
             SUM(CASE WHEN ou_correct = 1 THEN 1 ELSE 0 END) as ou_wins
      FROM (
        SELECT ml_correct, ou_correct,
          CASE
            WHEN confidence_score >= 70 THEN 'High'
            WHEN confidence_score >= 50 THEN 'Moderate'
            ELSE 'Low'
          END as tier
        FROM predictions
        WHERE ml_correct IS NOT NULL
      )
      GROUP BY tier
    `).all();

    // Accuracy by season type
    const bySeasonType = db.prepare(`
      SELECT season_type,
             COUNT(*) as total,
             SUM(CASE WHEN ml_correct = 1 THEN 1 ELSE 0 END) as ml_wins,
             SUM(CASE WHEN ou_correct = 1 THEN 1 ELSE 0 END) as ou_wins,
             SUM(CASE WHEN ou_correct IS NOT NULL THEN 1 ELSE 0 END) as ou_graded
      FROM predictions
      WHERE ml_correct IS NOT NULL
      GROUP BY season_type
    `).all();

    // Running accuracy (chronological — for trend tracking)
    const gradedOrdered = db.prepare(`
      SELECT ml_correct, ou_correct
      FROM predictions
      WHERE ml_correct IS NOT NULL
      ORDER BY saved_at ASC
    `).all();

    let mlW = 0, ouW = 0, ouN = 0;
    const runningML = [], runningOU = [];
    gradedOrdered.forEach((r, i) => {
      mlW += r.ml_correct;
      runningML.push(+(mlW / (i + 1) * 100).toFixed(1));
      if (r.ou_correct !== null) {
        ouW += r.ou_correct;
        ouN++;
        runningOU.push(+(ouW / ouN * 100).toFixed(1));
      }
    });

    // Last-5 and last-10 windows
    const last5ML  = runningML.length >= 1 ? +(gradedOrdered.slice(-5).reduce((s, r) => s + r.ml_correct, 0) / Math.min(5, gradedOrdered.length) * 100).toFixed(1) : null;
    const last10ML = runningML.length >= 1 ? +(gradedOrdered.slice(-10).reduce((s, r) => s + r.ml_correct, 0) / Math.min(10, gradedOrdered.length) * 100).toFixed(1) : null;
    const last5OU  = (() => { const s = gradedOrdered.filter(r => r.ou_correct !== null).slice(-5); return s.length ? +(s.reduce((a, r) => a + r.ou_correct, 0) / s.length * 100).toFixed(1) : null; })();
    const last10OU = (() => { const s = gradedOrdered.filter(r => r.ou_correct !== null).slice(-10); return s.length ? +(s.reduce((a, r) => a + r.ou_correct, 0) / s.length * 100).toFixed(1) : null; })();

    // Last 10 graded
    const recent = db.prepare(`
      SELECT id, game_date, home_team, away_team, home_win_pct, away_win_pct,
             ou_prediction, ou_line, confidence_score,
             actual_home_score, actual_away_score, ml_correct, ou_correct
      FROM predictions
      WHERE ml_correct IS NOT NULL
      ORDER BY saved_at DESC LIMIT 10
    `).all();

    res.json({
      success: true,
      total: total,
      graded: graded,
      ml_accuracy: graded > 0 ? +(mlWins / graded * 100).toFixed(1) : null,
      ml_wins: mlWins,
      ml_losses: graded - mlWins,
      ou_graded: ouGraded,
      ou_accuracy: ouGraded > 0 ? +(ouWins / ouGraded * 100).toFixed(1) : null,
      ou_wins: ouWins,
      ou_losses: ouGraded - ouWins,
      by_season_type: bySeasonType,
      by_tier: byTier,
      running_ml: runningML,
      running_ou: runningOU,
      last5_ml: last5ML,
      last10_ml: last10ML,
      last5_ou: last5OU,
      last10_ou: last10OU,
      recent: recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Data Import (one-time migration) ────────────────────────────────────────
app.post("/api/import", (req, res) => {
  try {
    const secret = req.headers["x-import-secret"];
    if (!secret || secret !== process.env.IMPORT_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const rows = req.body.rows;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows array required" });

    const importRow = db.prepare(`
      INSERT OR IGNORE INTO predictions (
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
    `);

    const importAll = db.transaction((rows) => {
      let inserted = 0;
      for (const row of rows) {
        const result = importRow.run(row);
        inserted += result.changes;
      }
      return inserted;
    });

    const inserted = importAll(rows);
    res.json({ success: true, inserted, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Manual prediction entry ──────────────────────────────────────────────────
app.post("/api/manual-entry", (req, res) => {
  try {
    const { type, export_string, json_text, game_date, season_type, notes } = req.body;
    let pred = {};

    if (type === "export_string" && export_string) {
      // Format: Away @ Home,Home SP (HOME),Away SP (AWAY),56%,44%,8.5,61% (Over)
      const parts = export_string.split(",").map(s => s.trim());
      if (parts.length < 7) return res.status(400).json({ error: "Export string needs 7 fields: Away @ Home, Home SP, Away SP, Home%, Away%, Line, Over% (Over/Under)" });

      const atIdx = parts[0].indexOf(" @ ");
      if (atIdx === -1) return res.status(400).json({ error: 'First field must contain " @ " — e.g. "Red Sox @ Yankees"' });

      pred.away_team    = parts[0].slice(0, atIdx).trim();
      pred.home_team    = parts[0].slice(atIdx + 3).trim();
      pred.home_starter = parts[1] || null;
      pred.away_starter = parts[2] || null;
      pred.home_win_pct = parseInt(parts[3]) || null;
      pred.away_win_pct = parseInt(parts[4]) || null;
      pred.ou_line      = parts[5] || null;

      const ouPctMatch = (parts[6] || "").match(/(\d+)%/);
      pred.ou_over_pct  = ouPctMatch ? parseInt(ouPctMatch[1]) : null;
      const ouDirMatch  = (parts[6] || "").match(/\((Over|Under)\)/i);
      pred.ou_prediction = ouDirMatch ? ouDirMatch[1].toUpperCase() : null;

      if (pred.ou_over_pct != null) {
        const p = pred.ou_over_pct;
        pred.ou_confidence = (p >= 70 || p <= 30) ? "High" : (p >= 59 || p <= 41) ? "Moderate" : "Low";
      }

    } else if (type === "json" && json_text) {
      try { pred = JSON.parse(json_text); }
      catch (e) { return res.status(400).json({ error: "Invalid JSON: " + e.message }); }
    } else {
      return res.status(400).json({ error: "type must be 'export_string' or 'json', with the corresponding text field" });
    }

    const stmt = db.prepare(`
      INSERT INTO predictions (
        saved_at, game_date, season_type, home_team, away_team,
        home_starter, away_starter, home_win_pct, away_win_pct,
        ou_line, ou_prediction, ou_confidence, ou_over_pct, confidence_score,
        gvi, home_tms, away_tms, home_pms, away_pms,
        home_pvs, away_pvs, home_red, away_red, pdcf_active,
        active_flags, active_overrides, betting_recommendation,
        key_driver, reasoning, export_string, full_prediction, notes
      ) VALUES (
        @saved_at, @game_date, @season_type, @home_team, @away_team,
        @home_starter, @away_starter, @home_win_pct, @away_win_pct,
        @ou_line, @ou_prediction, @ou_confidence, @ou_over_pct, @confidence_score,
        @gvi, @home_tms, @away_tms, @home_pms, @away_pms,
        @home_pvs, @away_pvs, @home_red, @away_red, @pdcf_active,
        @active_flags, @active_overrides, @betting_recommendation,
        @key_driver, @reasoning, @export_string, @full_prediction, @notes
      )
    `);

    const n = v => (v === undefined || v === null || v === "") ? null : v;
    const result = stmt.run({
      saved_at:             new Date().toISOString(),
      game_date:            n(game_date) || n(pred.game_date),
      season_type:          n(season_type) || n(pred.season_type) || "Regular Season",
      home_team:            n(pred.home_team),
      away_team:            n(pred.away_team),
      home_starter:         n(pred.home_starter),
      away_starter:         n(pred.away_starter),
      home_win_pct:         n(pred.home_win_pct),
      away_win_pct:         n(pred.away_win_pct),
      ou_line:              n(pred.ou_line),
      ou_prediction:        n(pred.ou_prediction),
      ou_confidence:        n(pred.ou_confidence),
      ou_over_pct:          n(pred.ou_over_pct),
      confidence_score:     n(pred.confidence_score),
      gvi:                  n(pred.gvi),
      home_tms:             n(pred.home_tms),
      away_tms:             n(pred.away_tms),
      home_pms:             n(pred.home_pms),
      away_pms:             n(pred.away_pms),
      home_pvs:             n(pred.home_pvs),
      away_pvs:             n(pred.away_pvs),
      home_red:             n(pred.home_red),
      away_red:             n(pred.away_red),
      pdcf_active:          pred.pdcf_active ? 1 : 0,
      active_flags:         pred.active_flags ? (typeof pred.active_flags === "string" ? pred.active_flags : JSON.stringify(pred.active_flags)) : null,
      active_overrides:     pred.active_overrides ? (typeof pred.active_overrides === "string" ? pred.active_overrides : JSON.stringify(pred.active_overrides)) : null,
      betting_recommendation: n(pred.betting_recommendation),
      key_driver:           n(pred.key_driver),
      reasoning:            n(pred.reasoning),
      export_string:        type === "export_string" ? export_string : n(pred.export_string),
      full_prediction:      type === "json" ? json_text : n(pred.full_prediction),
      notes:                n(notes) || n(pred.notes) || "Manual entry",
    });

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete prediction ────────────────────────────────────────────────────────
app.delete("/api/predictions/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    db.prepare("DELETE FROM predictions WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pattern Analysis API ─────────────────────────────────────────────────────
app.get("/api/pattern-analysis", (_req, res) => {
  try {
    const overall = {
      total:     db.prepare("SELECT COUNT(*) as n FROM predictions").get().n,
      graded:    db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ml_correct IS NOT NULL").get().n,
      ml_wins:   db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ml_correct = 1").get().n,
      ou_graded: db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ou_correct IS NOT NULL").get().n,
      ou_wins:   db.prepare("SELECT COUNT(*) as n FROM predictions WHERE ou_correct = 1").get().n,
    };

    const byConfidence = db.prepare(`
      SELECT
        CASE
          WHEN confidence_score < 50 THEN 'Below 50'
          WHEN confidence_score < 55 THEN '50–54'
          WHEN confidence_score < 60 THEN '55–59'
          WHEN confidence_score < 65 THEN '60–64'
          WHEN confidence_score < 70 THEN '65–69'
          ELSE '70+'
        END as bucket,
        COUNT(*) as total,
        COALESCE(SUM(ml_correct),0) as ml_wins,
        COALESCE(SUM(CASE WHEN ou_correct IS NOT NULL THEN 1 ELSE 0 END),0) as ou_graded,
        COALESCE(SUM(ou_correct),0) as ou_wins
      FROM predictions WHERE ml_correct IS NOT NULL GROUP BY bucket
    `).all();

    const byLineRange = db.prepare(`
      SELECT
        CASE
          WHEN CAST(ou_line AS REAL) < 7.0  THEN '<7.0'
          WHEN CAST(ou_line AS REAL) < 8.0  THEN '7.0–7.9'
          WHEN CAST(ou_line AS REAL) < 9.0  THEN '8.0–8.9'
          WHEN CAST(ou_line AS REAL) < 10.0 THEN '9.0–9.9'
          ELSE '10.0+'
        END as line_range,
        ou_prediction,
        COUNT(*) as total,
        COALESCE(SUM(ou_correct),0) as ou_wins,
        MIN(CAST(ou_line AS REAL)) as min_line
      FROM predictions
      WHERE ou_correct IS NOT NULL AND ou_line IS NOT NULL AND ou_line != ''
      GROUP BY line_range, ou_prediction ORDER BY min_line
    `).all();

    const byMonth = db.prepare(`
      SELECT
        strftime('%Y-%m', COALESCE(game_date, saved_at)) as month,
        COUNT(*) as total,
        COALESCE(SUM(ml_correct),0) as ml_wins,
        COALESCE(SUM(CASE WHEN ou_correct IS NOT NULL THEN 1 ELSE 0 END),0) as ou_graded,
        COALESCE(SUM(ou_correct),0) as ou_wins
      FROM predictions WHERE ml_correct IS NOT NULL
      GROUP BY month ORDER BY month
    `).all();

    const byWP = db.prepare(`
      SELECT
        CASE
          WHEN MAX(COALESCE(home_win_pct,0), COALESCE(away_win_pct,0)) >= 70 THEN '≥70%'
          WHEN MAX(COALESCE(home_win_pct,0), COALESCE(away_win_pct,0)) >= 65 THEN '65–69%'
          WHEN MAX(COALESCE(home_win_pct,0), COALESCE(away_win_pct,0)) >= 60 THEN '60–64%'
          WHEN MAX(COALESCE(home_win_pct,0), COALESCE(away_win_pct,0)) >= 55 THEN '55–59%'
          ELSE '50–54%'
        END as wp_bucket,
        COUNT(*) as total,
        COALESCE(SUM(ml_correct),0) as ml_wins
      FROM predictions WHERE ml_correct IS NOT NULL GROUP BY wp_bucket
    `).all();

    const byDirection = db.prepare(`
      SELECT ou_prediction, COUNT(*) as total, COALESCE(SUM(ou_correct),0) as ou_wins
      FROM predictions WHERE ou_correct IS NOT NULL AND ou_prediction IS NOT NULL
      GROUP BY ou_prediction
    `).all();

    const byOUTier = db.prepare(`
      SELECT ou_confidence, COUNT(*) as total, COALESCE(SUM(ou_correct),0) as ou_wins
      FROM predictions WHERE ou_correct IS NOT NULL AND ou_confidence IS NOT NULL
      GROUP BY ou_confidence
    `).all();

    const totalDist = db.prepare(`
      SELECT
        CASE
          WHEN actual_total <  5 THEN '0–4'
          WHEN actual_total <  7 THEN '5–6'
          WHEN actual_total <  9 THEN '7–8'
          WHEN actual_total < 11 THEN '9–10'
          WHEN actual_total < 13 THEN '11–12'
          WHEN actual_total < 15 THEN '13–14'
          ELSE '15+'
        END as range,
        COUNT(*) as cnt, MIN(actual_total) as min_val
      FROM predictions WHERE actual_total IS NOT NULL
      GROUP BY range ORDER BY min_val
    `).all();

    const trend = db.prepare(`
      SELECT game_date, saved_at, ml_correct, ou_correct, confidence_score, home_win_pct, away_win_pct
      FROM predictions WHERE ml_correct IS NOT NULL
      ORDER BY COALESCE(game_date, saved_at) ASC
    `).all();

    const homeAway = db.prepare(`
      SELECT
        CASE WHEN COALESCE(home_win_pct,0) >= COALESCE(away_win_pct,0) THEN 'Home' ELSE 'Away' END as pick,
        COUNT(*) as total,
        COALESCE(SUM(ml_correct),0) as wins
      FROM predictions WHERE ml_correct IS NOT NULL GROUP BY pick
    `).all();

    const byHandedness = db.prepare(`
      SELECT
        CASE
          WHEN home_starter LIKE '%(L)%' AND away_starter LIKE '%(L)%' THEN 'Both LHP'
          WHEN home_starter LIKE '%(L)%' AND away_starter LIKE '%(R)%' THEN 'Away RHP vs Home LHP'
          WHEN home_starter LIKE '%(R)%' AND away_starter LIKE '%(L)%' THEN 'Away LHP vs Home RHP'
          ELSE 'Both RHP'
        END as matchup,
        COUNT(*) as total,
        COALESCE(SUM(ml_correct),0) as ml_wins,
        COALESCE(SUM(CASE WHEN ou_correct IS NOT NULL THEN 1 ELSE 0 END),0) as ou_graded,
        COALESCE(SUM(ou_correct),0) as ou_wins
      FROM predictions WHERE ml_correct IS NOT NULL AND home_starter IS NOT NULL AND away_starter IS NOT NULL
      GROUP BY matchup ORDER BY total DESC
    `).all();

    const byGVI = db.prepare(`
      SELECT
        CASE
          WHEN gvi IS NULL THEN 'Unknown'
          WHEN gvi < 35   THEN '<35 (Low)'
          WHEN gvi < 50   THEN '35–49'
          WHEN gvi < 65   THEN '50–64'
          WHEN gvi < 80   THEN '65–79'
          ELSE '80+ (High)'
        END as gvi_bucket,
        CASE WHEN gvi IS NULL THEN 99 WHEN gvi < 35 THEN 0 WHEN gvi < 50 THEN 1 WHEN gvi < 65 THEN 2 WHEN gvi < 80 THEN 3 ELSE 4 END as ord,
        COUNT(*) as total,
        COALESCE(SUM(ml_correct),0) as ml_wins,
        COALESCE(SUM(CASE WHEN ou_correct IS NOT NULL THEN 1 ELSE 0 END),0) as ou_graded,
        COALESCE(SUM(ou_correct),0) as ou_wins
      FROM predictions WHERE ml_correct IS NOT NULL
      GROUP BY gvi_bucket ORDER BY ord
    `).all();

    const byGranularLine = db.prepare(`
      SELECT
        CASE
          WHEN CAST(ou_line AS REAL) < 7.5  THEN '7.0'
          WHEN CAST(ou_line AS REAL) < 8.0  THEN '7.5'
          WHEN CAST(ou_line AS REAL) < 8.5  THEN '8.0'
          WHEN CAST(ou_line AS REAL) < 9.0  THEN '8.5'
          WHEN CAST(ou_line AS REAL) < 9.5  THEN '9.0'
          WHEN CAST(ou_line AS REAL) < 10.0 THEN '9.5'
          ELSE '10.0+'
        END as line_bucket,
        ou_prediction,
        COUNT(*) as total,
        COALESCE(SUM(ou_correct),0) as ou_wins,
        MIN(CAST(ou_line AS REAL)) as min_line
      FROM predictions
      WHERE ou_correct IS NOT NULL AND ou_line IS NOT NULL AND ou_line != '' AND CAST(ou_line AS REAL) >= 7.0
      GROUP BY line_bucket, ou_prediction ORDER BY min_line
    `).all();

    const bySeasonType = db.prepare(`
      SELECT season_type,
        COUNT(*) as total,
        COALESCE(SUM(ml_correct),0) as ml_wins,
        COALESCE(SUM(CASE WHEN ou_correct IS NOT NULL THEN 1 ELSE 0 END),0) as ou_graded,
        COALESCE(SUM(ou_correct),0) as ou_wins
      FROM predictions WHERE ml_correct IS NOT NULL AND season_type IS NOT NULL
      GROUP BY season_type
    `).all();

    res.json({ overall, byConfidence, byLineRange, byMonth, byWP, byDirection, byOUTier, totalDist, trend, homeAway, byHandedness, byGVI, byGranularLine, bySeasonType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/patterns", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "patterns.html"));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/history", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "history.html"));
});

// Explicit route for /history (Vercel doesn't auto-resolve .html)
app.get("/history", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "history.html"));
});

// 404 handler — catches unknown routes and returns JSON instead of HTML
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler — ensures all errors return JSON with CORS headers
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Server error" });
});

module.exports = app;

app.listen(PORT, () => {
  console.log(`\n✅ MLB Analyzer running at http://localhost:${PORT}\n`);
});
