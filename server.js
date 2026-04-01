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
const dbPath = process.env.VERCEL
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
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Store uploads in memory (buffer)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
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

const PREDICT_SYSTEM = `You are the MLB Game Predictor AI v2.1 with deep knowledge of MLB statistics, player profiles, and team performance. You handle both Regular Season and Postseason games.

## STEP 0 — FILL MISSING DATA BEFORE ANALYSIS

Before calculating any metric, inspect every field in the provided game data. For any field that is null, empty (""), zero ("0"), or missing:

1. PITCHER STATS — Recall from your MLB knowledge:
   - ERA, WHIP, xFIP, K/9, BB/9 for the named pitcher (current or most recent season)
   - Recent game log: reconstruct last 3–5 starts with estimated innings, earned runs, strikeouts, walks
   - Season W/L record and innings pitched totals

2. TEAM DATA — Recall from your MLB knowledge:
   - Current or recent season overall record, home record, road record
   - Recent form (last 5 and last 10 games)
   - Team batting average, on-base %, avg runs scored per game
   - Bullpen ERA and WHIP for the current season
   - Division standings and games back

3. ADVANCED METRICS — Estimate if missing:
   - xFIP: if not provided, estimate from ERA + BB rate profile (xFIP ≈ ERA + 0.3 for average control, lower for elite control)
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

**RED:** Avg ERA last 3 starts minus season ERA. Per-start ERA = (earned_runs/innings)*9. Flag RED<-1.0 = "Surging", RED>+1.5 = "Slumping". If RCF active (xFIP > ERA by >=1.20), substitute xFIP for ERA in all §4 calculations.

**TMS:** G1+G2+G3+G4+(G5*2) where Win=+3, Loss=-2, G5=most recent. Range -14 to +18. Apply -2 if team traveled 2+ time zones in last 24h.

**PMS:** Base 100 + season-appropriate bonuses:
  REGULAR SEASON: Division Race within 3 games (+30), Wild Card Race within 3 games (+20), Must-Win 5+ loss streak in race (+15), Divisional Rivalry (+15), September game (+10), Series momentum won 2+ in row (+10). Apply highest race bonus only (not both).
  POSTSEASON: Elimination Game (+50), Series Clinch (+25), Series Momentum won 2+ in row (+15), Divisional Rivalry (+15).
  Win% shift = (Home PMS - Away PMS) / 50, capped at ±4%, applied to home team.

**RCF:** xFIP > ERA by >=1.20 → flag "Regression Risk". Substitute xFIP for ERA downstream.

**GVI:** Start 50. Adjustments: +15 per pitcher PVS>15; -15 per pitcher ERA/xFIP<2.50; -8 per pitcher ERA/xFIP 2.50-3.00; +10 per team 30-day wRC+>110; +10 wind OUT 8-15mph; +20 wind OUT >15mph; -10 wind IN >8mph; -10 temp<50F; +8 hitter's park; -8 pitcher's park; +5 batter-friendly ump; -5 pitcher-friendly ump; -5 per team with elite defense; +5 if postseason OR both teams in active race. Cap 1-100. Flag GVI>65=OVER bias, GVI<35=UNDER bias.

## §4 WIN PROBABILITY SYNTHESIS

Start 50/50. Apply all in order:
1. Home base: +2%
2. PMS shift: (HomePMS-AwayPMS)/50 capped ±4%
3. H2H: >=65% record last 3 seasons → +3% to that team
4. Defense: -2% to opponent per team with elite DRS/OAA
5. WP-Override A (priority): Surging ace (xFIP<3.25, RED<-1.0) vs Slumping (RED>+1.5) → +14%. Flag "WP-Override A fired".
6. WP-Override B: Home Fortress (home win%>=.650) vs road team (road win%<.500) → +10%. Flag "WP-Override B fired".
7. No dominant override → Driver 1 (Momentum): higher TMS +4% (halved to +2% if facing opponent xFIP<3.00). Driver 2 (Venue): Home Fortress +5%.
8. PDCF: road team higher TMS AND home team Home Fortress → flag PDCF, apply tiebreakers:
   Bullpen xFIP diff>0.40 → +4% | Platoon wRC+ diff>15 → +3% | RISP wRC+ → +2% | All tied: 52/48 home.
9. Normalize to 100. Cap 80/20. Check HFCF (>=68%). Check MCF (contradicts betting favorite).

## §5 O/U SYNTHESIS — stop at first trigger

OU-A: Surging vs Slumping → Lean OVER (Strong OVER if slumping team 15-day wRC+>108). Both Surging → Strong UNDER. Veto: wind OUT>15mph nullifies UNDER only; reinforces OVER to High confidence.
OU-B: Wind OUT>8mph → OVER. Wind IN>8mph → UNDER. Wind OUT>15mph → Strong OVER.
OU-C: Both teams 15-day wRC+>115 → OVER.
OU-D: Balance Ace Suppressor (xFIP<3.25) vs Red Hot Offense (wRC+>110, avg_runs>5.0). Park factor and temp<50F.
OU-E: GVI>65 → OVER. GVI<35 → UNDER. GVI 35-65 → neutral.

Confidence: High=2+ signals align. Moderate=1 strong. Low=GVI only.
Over%: High OVER=72%, Moderate OVER=61%, Low OVER=54%, Low UNDER=46%, Moderate UNDER=39%, High UNDER=28%.

## §6 CONFIDENCE — start 100, floor 25

PDCF:-30. MCF:-25. HFCF(>=68%):-20. TMF(5+ loss streak):-20. HVIF(GVI>75):-15. HSGV(elimination game OR both teams within 1 game of cutoff):-15. SWR(precip>40%):-10.

## BETTING RECOMMENDATION

win%>=62% AND conf>=65 → "Strong lean: [Team] ML · [OU] [Line] ([conf])"
win% 56-62% AND conf>=58 → "Moderate lean: [Team] ML · [OU] [Line] ([conf])"
win% 52-56% AND conf>=50 → "Slight lean: [Team] ML · [OU] [Line] ([conf])"
else → "No strong ML play · Slight lean [OU] [Line] (low conviction)"

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
  "betting_recommendation": "specific actionable recommendation",
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
      content: `Apply the MLB Game Predictor v2.2 framework to this extracted game data. Fill any missing fields from your knowledge base first, then return the complete JSON prediction:\n\n${JSON.stringify(gameData, null, 2)}${notesBlock}`,
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

    res.json({ success: true, ml_correct, ou_correct, ou_result, actual_total: total });
  } catch (err) {
    console.error("Result error:", err);
    res.status(500).json({ error: err.message || "Failed to save result" });
  }
});

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
