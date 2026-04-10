require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
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
    console.log(`[DB] Seeded ${rows.length} records from predictions-export.json`);
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

const PREDICT_SYSTEM = `You are the MLB Game Predictor AI v2.7 with deep knowledge of MLB statistics, player profiles, and team performance. You handle both Regular Season and Postseason games.

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
If RCF active (xFIP > ERA by >=1.20), substitute xFIP for ERA in all §4 calculations.

**TMS:** G1+G2+G3+G4+(G5*2) where Win=+3, Loss=-2, G5=most recent. Range -14 to +18. Apply -2 if team traveled 2+ time zones in last 24h.
EARLY SEASON TMS CAP: <5 games played = 0% weight (ignore TMS). 5-9 games = 25% weight. >=10 games = 100% weight.

**PMS:** Base 100 + season-appropriate bonuses:
  REGULAR SEASON: Division Race within 3 games (+30), Wild Card Race within 3 games (+20), Must-Win 5+ loss streak in race (+15), Divisional Rivalry (+15), September game (+10), Series momentum won 2+ in row (+10). Apply highest race bonus only.
  POSTSEASON: Elimination Game (+50), Series Clinch (+25), Series Momentum won 2+ in row (+15), Divisional Rivalry (+15).
  Win% shift = (Home PMS - Away PMS) / 50, capped at ±4%.

**RCF:** xFIP > ERA by >=1.20 → flag "Regression Risk". Substitute xFIP for ERA downstream.

**DOUBLEHEADER G2 CHECK (v2.6):** Before computing GVI, check if this is DH G2. If yes: set dh_g2=true, add +8 to GVI, apply OVER lean in §5, never output UNDER bet recommendation.

**PROJECTED TOTAL (v2.6):** Compute projected_total = (home_avg_runs + away_avg_runs) × park_factor_multiplier. Bullpen adjustment: +0.5 if either bullpen ERA > 4.50; -0.3 if either < 3.50. Record this value. O/U bet requires |projected_total - ou_line| ≥ 2.0 runs — if gap < 2.0, set ou_bet_eligible=false.

**§3.10 PATTERN POLICY CHECKS (v2.7):** After computing all metrics, evaluate ALL 10 patterns. Record each as true/false in pattern_matches JSON field. Evaluate in this order: P6→P8→P4→P7→P9→P10→P1/P2/P3→P5.

P1_dome_dual_ace: Indoor/dome stadium AND both SPs xFIP≤3.25 (or ERA≤2.80) → Pattern A UNDER signal (67% hit rate)
P2_home_ace_mid_offence: Home SP xFIP≤3.25 AND away team 30-day wRC+ between 85-104 → Pattern B UNDER signal (63% hit rate)
P3_cold_natural_grass: Temp<45°F AND natural grass field AND no wind OUT>5mph → Pattern B UNDER signal (60% hit rate). Cancel if any wind OUT>5mph.
P4_road_ace_veto: Away SP xFIP≤3.25 pitching on road → SET P4_road_ace_veto=true. BAN all bets this game. No O/U recommendation. (50% hit rate = no edge)
P5_confidence_zone: Final confidence score 50-64 → P5=true. This is the ONLY valid zone for active O/U bets. Below 50 or above 64 = Pass.
P6_ml_ban: ALWAYS true. ML bets are PERMANENTLY BANNED (39% hit rate, -13.7% ROI). Never output a moneyline recommendation. Set ml_recommendation="BANNED — P6_BAN active".
P7_hot_batting_skip: Either team avg_runs≥5.0 AND on a win streak of 3+ games → SET P7=true. Issue HARD SKIP warning. Do not auto-recommend a bet. (14% hit rate, -38.7% ROI)
P8_venue_cold_under_ban: Game at Target Field (MIN Twins) OR Progressive Field (CLE Guardians) AND temp<55°F AND ou_prediction=UNDER → SET P8=true. BAN this bet. (20% hit rate)
P9_high_confidence_cap: Final confidence score≥65 → SET P9=true. Cap effective betting confidence at 64. Do not issue a bet at ≥65. (25% hit rate at 65+, -27.7% ROI)
P10_projected_total_lte65: projected_total≤6.5 AND ou_prediction=UNDER → SET P10=true. Strong UNDER signal (100% hit rate across 27 games). Escalate UNDER confidence to Moderate if currently Low (still subject to April gate).

**GVI:** Start 50. Adjustments: +15 per pitcher PVS>15; -15 per pitcher ERA/xFIP<2.50; -8 per pitcher ERA/xFIP 2.50-3.00; +10 per team 30-day wRC+>110; +10 wind OUT 8-15mph; +20 wind OUT >15mph; -10 wind IN >8mph; -10 temp<50F; +8 hitter's park; -8 pitcher's park; +5 batter-friendly ump; -5 pitcher-friendly ump; -5 per team with elite defense; +5 if postseason OR both teams in active race.
APRIL GVI ADJUSTMENTS: -5 if April 1-14; additional -5 if April 1-14 AND line>8.0; additional -5 if April AND OVER signal active.
DH G2 ADJUSTMENT (v2.6): +8 to GVI if dh_g2=true.
Cap 1-100. Flag GVI>65=OVER bias, GVI<35=UNDER bias.
High-GVI/High-Line Dampener: GVI>75 AND line>8.0 → cap OU-E at Moderate.

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
5. WP-Override B: Home Fortress (home win%>=.650, or >=.700 if April) vs road team (road win%<.500) → +10%. Flag "WP-Override B fired".
6. No dominant override:
   - Driver 1 (Momentum): higher TMS +4%, subject to early-season cap.
     HOME TMS DAMPENER (April): if HOME team has higher TMS in April → +1% only (not +4%).
     AWAY MOMENTUM AMPLIFIER: away team TMS leads by 5+ points AND no WP-Override → additional +2% (total +6% away TMS).
   - Driver 2 (Venue): Home Fortress +5%.
7. Both SP Slumping: both RED>+1.5 → subtract 8% from favored team's win probability.
8. TMF: away team TMF → -3% home win%. Home team TMF → -5% home win%.
9. PDCF: road team higher TMS AND home team Home Fortress → apply tiebreakers:
   Bullpen xFIP diff>0.40 → +4% | Platoon wRC+ diff>15 → +3% | RISP wRC+ → +2% | All tied: 52/48 home.
10. HOME BONUS ACCUMULATION CAP (v2.5, April only): Sum all bonuses added to home team above April baseline. If total > +8%, trim excess (discard in order: Defense → H2H → PMS → Fortress). WP-Override A exempt.
11. Normalize to 100. Cap 80/20. Check HFCF (>=68%). Check MCF (contradicts betting favorite).
12. NO-EDGE PASS THRESHOLD (v2.5): If final home win% is 47-53% → set ml_edge="no-edge". ML betting recommendation = Pass. Continue to O/U normally.

## §5 O/U SYNTHESIS

**⚠️ MANDATORY APRIL O/U GATE (v2.5):** If game_date is April 1-30, record april_ou_gate=ACTIVE. Run OU-A through OU-E to determine DIRECTION only. Then, AFTER setting direction, FORCE confidence to Moderate before writing output. Do NOT output High in April. Only exception: UNDER may reach High if ALL of the following are confirmed (not estimated): ace xFIP<3.00 from current-season starts + pitcher's park + temp<55F + GVI<30. This is the final step — apply it last.

**xFIP ESTIMATION GATE (v2.5):** If a pitcher's xFIP is tagged "estimated" (not confirmed from current-season logs), that xFIP cannot drive High O/U confidence — cap at Moderate. If 2+ key inputs are estimated (xFIP, RED, 30-day wRC+), force Moderate regardless of GVI.

Evaluate in strict order, stop at first trigger:

OU-A: Surging vs Slumping → Lean OVER (Strong OVER if slumping team 15-day wRC+>108). Both Surging → Strong UNDER (Moderate max in April). Both Slumping (both RED>+1.5) → Lean OVER + WP equalize -8% favored team.
SINGLE-ACE APRIL CAP: In April, single-ace UNDER → Moderate max. High requires 3+ confirmed suppression factors.
Wind OUT>15mph veto: nullifies OU-A UNDER; reinforces OU-A OVER to High confidence.
WIND-COLD GATE: If wind OUT AND temp<60F → cancel wind OVER bonus, fall through to OU-D.

OU-B: Wind OUT>8mph → OVER (cancelled if temp<60F). Wind IN>8mph → UNDER (never vetoed by pitcher quality). Wind OUT>15mph → Strong OVER (cancelled if temp<60F; Lean OVER if temp 60-64F).
WIND-ACE INTERACTION (v2.6): Before firing any wind OUT signal — check confirmed xFIP. Both SPs xFIP > 3.50 → OU-B fires normally. Either SP xFIP ≤ 3.25 (confirmed) → downgrade to OU-D input only, not primary OU-B trigger. Both SPs xFIP ≤ 3.25 → cancel OU-B entirely, fall to OU-D. Flag "Wind-Ace Veto active".

OU-C: Both teams 15-day wRC+>115 → OVER.

OU-D: Balance Ace Suppressor (xFIP<3.25) vs Red Hot Offense (wRC+>110, avg_runs>5.0). Park factor. Temp<50F → UNDER bias. Conflict → fall to OU-E.

OU-E: GVI>65 → OVER. GVI<35 → UNDER. GVI 35-65 → neutral, lean nearest driver or match market.

OU-F (April UNDER Default): If April AND neither OU-B nor OU-C fired → default UNDER (Low confidence).
HIGH-LINE EXTENSION: April AND line>=9.0 AND temp<68F → force UNDER (Low) even if OU-B fired.
LOW-LINE UNDER CAP: April AND line<=8.0 AND UNDER → cap at Moderate.
LOW-LINE UNDER FLOOR (v2.5): April AND line<=7.5 AND UNDER → cap at Low. Every UNDER on 7.5 line in April missed high.
Exception: override to OVER if temp>=68F AND hitter's park AND avg_runs>5.0 both teams.
EMPIRICAL NOTE (v2.5): 32-game data shows 50/50 actual OVER/UNDER with lines running +0.52 below actuals. UNDER default is Low confidence only.

After determining direction, apply Mandatory April O/U Gate and xFIP Estimation Gate before setting final confidence.

Confidence assignment:
- High: 3+ confirmed suppression signals stack AND not in April — OR 2+ OVER signals clearly align outside April
- Moderate: 1 strong signal or 2 conflicting resolved by GVI; maximum tier in April (per gate)
- Low: GVI tiebreaker only, unresolved conflict, OU-F default, or high-line UNDER

Over%: High OVER=72%, Moderate OVER=61%, Low OVER=54%, Low UNDER=46%, Moderate UNDER=39%, High UNDER=28%.

## §6 CONFIDENCE — start 100, floor 25, April ceiling 70

PDCF:-30. MCF:-25. HFCF(>=68%):-20. TMF(5+ loss streak):-20. HVIF(GVI>75):-15. HSGV(elimination game OR both teams within 1 game of cutoff):-15. KHA(April AND 3+ pitcher stats from knowledge):-15. VMF(GVI>70 AND win% 55-65%):-10. ESDU(early season AND 2+ fields estimated):-10. BSS(both pitchers RED>+1.5):-10. AOP(OVER pick in April):-10. SWR(precip>40%):-10. AHP(home team wins in April):-8. KXF(UNDER driven by estimated xFIP):-10.
HBTF(v2.7, hot batting team P7_SKIP active):-25. RAF(v2.7, road ace P4_VETO active):-30. HCB(v2.7, confidence>=65 P9_BAN active):-20. VCB(v2.7, venue cold UNDER P8_BAN active):-30.
April ceiling: cap final score at 70 for any April game.

## BETTING RECOMMENDATION (v2.7)

⚠️ ML BETS PERMANENTLY BANNED (P6_BAN): 39% hit rate across 34 games (-13.7% ROI). Never output a moneyline bet recommendation under any condition. Set ml_recommendation="BANNED — P6_BAN active". Win probability is output for informational purposes only.

VARIANCE NOTE: MLB total SD ≈ 4.5 runs. A 1.2-run model edge = only 0.27 SD = ~53% theoretical win rate. Only recommend bets with clear structural edges.

O/U BET TIERS (v2.7) — evaluate in order:
1. P4_VETO=true → betting_recommendation = "Pass — P4_VETO active (road ace: no edge at 50%)"
2. P8_BAN=true → betting_recommendation = "Pass — P8_BAN active (venue cold UNDER: 20% hit rate)"
3. P7_SKIP=true → betting_recommendation = "⚠️ Hard Skip — P7_SKIP active ([Team] hot batting team). Review before betting."
4. ou_bet_eligible=false → betting_recommendation = "Pass (insufficient gap — projected [X] vs line [Y])"
5. dh_g2=true AND ou_prediction=UNDER → betting_recommendation = "Pass (DH G2 — never bet UNDER)"
6. P9_BAN=true (conf>=65) → betting_recommendation = "Pass — P9_BAN active (conf [X]≥65, capped at 64; 25% historical hit rate)"
7. P5_ZONE=true (conf 50-64) AND P1_dome_dual_ace=true → betting_recommendation = "Pattern A: UNDER [line] (Moderate) — $150 unit"
8. P5_ZONE=true AND (P2_home_ace_mid_offence=true OR P3_cold_natural_grass=true) → betting_recommendation = "Pattern B: UNDER [line] (Moderate) — $75 unit"
9. P5_ZONE=true AND P10_projected_total_lte65=true → betting_recommendation = "Strong UNDER: UNDER [line] — $75 unit"
10. P5_ZONE=true → betting_recommendation = "Standard: [OVER/UNDER] [line] ([conf]) — $50 unit"
11. conf<50 → betting_recommendation = "Pass (confidence [X] below 50 minimum threshold)"

SLATE DISCIPLINE CAP: Maximum 2 bets per daily slate. Rank by confidence, pick top 2 only.

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
  "ou_prediction": "OVER or UNDER",
  "ou_confidence": "Low or Moderate or High",
  "ou_over_pct": integer,
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
  "ml_recommendation": "BANNED — P6_BAN active",
  "betting_recommendation": "specific actionable O/U recommendation",
  "pattern_matches": {
    "P1_dome_dual_ace": false,
    "P2_home_ace_mid_offence": false,
    "P3_cold_natural_grass": false,
    "P4_road_ace_veto": false,
    "P5_confidence_zone": false,
    "P6_ml_ban": true,
    "P7_hot_batting_skip": false,
    "P8_venue_cold_under_ban": false,
    "P9_high_confidence_cap": false,
    "P10_projected_total_lte65": false,
    "pattern_tier": "Pattern A or Pattern B or Standard or null",
    "pattern_flags_fired": ["P6_BAN"],
    "hard_bans_active": ["P6_BAN"],
    "hard_skips_active": []
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
