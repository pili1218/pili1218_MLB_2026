# MLB Game Predictor — Analytical Framework v2.2

> **Operational protocol for Claude Code.**
> When analyzing an MLB matchup, follow every section in order. Do not skip steps.
> Applies to **Regular Season and Postseason**. Season-specific rules are clearly labeled.
> v2.2 — Accuracy revision based on 10-game empirical results: 7 structural fixes applied.

---

## 1. Objective

Provide a comprehensive pre-game analysis for any MLB game — regular season or postseason — predicting winning chances and the likelihood of a high-scoring game with higher accuracy through a revised, dynamic, and hierarchical analytical process that incorporates advanced metrics and refined situational logic.

---

## 2. Core Components & Data Inputs

### Match Identification
- Date, Time, Home Team, Away Team, Venue
- **Season Type:** `Regular Season` or `Postseason`
- **Season Context:**
  - *Regular Season:* Month of season, series game number (Game 1/2/3 of series), standings position
  - *Postseason:* Round (Wild Card / ALDS / ALCS / World Series), game number in series, series score (e.g. 2-1)

### Situational Factors
- **Weather:** Temperature, Humidity, Wind speed/direction (specify blowing OUT or IN toward CF)
- **Home Plate Umpire Tendency:** Pitcher-Friendly (tight zone) | Neutral | Batter-Friendly (wide zone)
- **Team Travel/Fatigue Status:** Note if team traveled across 2+ time zones within the last 24 hours
- **Venue-Specific Factors:** Park Factor classification (Hitter's Park / Neutral / Pitcher's Park)
- **Home Fortress Flag:** Triggered if a team's home winning percentage is .650 or higher

#### Regular Season Only Flags
- **Division Race Flag:** Team within 3 games of their division lead
- **Wild Card Race Flag:** Team within 3 games of a wild card position
- **Late Season Flag:** Game played in September or October regular season
- **Must-Win Flag:** Team on a 5+ game losing streak in a division/wild card race

#### Postseason Only Flags
- **Elimination Game Flag:** Team faces series elimination
- **Series Clinch Flag:** Team can clinch the series with a win
- **Series Momentum Flag:** Team has won 2+ consecutive games in the current series

### Starting Pitcher & Team-Based Factors
- Name, Handedness, Season Stats (ERA, WHIP)
- Advanced Metric: xFIP (Expected Fielder Independent Pitching)
- Recent Form: Last 5 Starts (Game Score per start), Last 3 Starts (ERA)
- **Bullpen Day/Opener Flag:** Triggered if the starter averaged fewer than 4.0 innings per start over their last five appearances. When active, shift 40% of analytical weight from starter metrics to bullpen ERA/WHIP/xFIP.

### Team Performance
- L5 Record, Game Streaks, Home/Away Records
- Recent wRC+ (Weighted Runs Created Plus) — 15-day window for §5C trigger; 30-day window for all other uses
- Splits (vs. LHP / RHP) — wRC+ differential vs. opposing starter handedness
- Recent Bullpen Performance: Last 15–30 Days ERA, WHIP, xFIP
- Team Defensive Metric: DRS or Outs Above Average (OAA)
- Situational Hitting: wRC+ with RISP over the last 30 days
- Historical Matchups: Head-to-Head Record (current season + last 2 seasons)
- **Regular Season only:** Current division standings, games back, run differential

---

## 3. Advanced Quantitative Assessment

Calculate all metrics below before proceeding to Section 4.

### 3.1 Pitcher Volatility Score (PVS)
Standard deviation of Game Score across the pitcher's last 5 starts.

**Game Score formula (per start):**
`Game Score = 50 + (IP × 3) + (K × 2) − (ER × 10) − (BB × 2) − (H × 1)`

**Flag:** PVS > 15 → "High Volatility (Home SP)" or "High Volatility (Away SP)"
**Data gap:** If fewer than 3 starts available, estimate PVS from ERA/WHIP profile and note as Data Notice.

---

### 3.2 Recent ERA Differential (RED)
`RED = (Average ERA over last 3 starts) − (Season ERA)`

Per-start ERA from game log: `(Earned Runs / IP) × 9`

**Flags:**
- RED < −1.0 → "Surging (Home SP)" or "Surging (Away SP)"
- RED > +1.5 → "Slumping (Home SP)" or "Slumping (Away SP)"

**Minimum Starts Gate (v2.2):** If a pitcher has fewer than **3 confirmed regular-season MLB starts in the current season**, set RED = 0 (neutral) and mark as `RED_unavailable`. WP-Override A cannot fire for a pitcher with `RED_unavailable` status. Knowledge-fill from spring training or prior seasons does **not** satisfy this gate. Add flag: "Early-Season RED Unreliable (Home SP)" or "Early-Season RED Unreliable (Away SP)".

**RCF interaction:** If the Regression Candidate Flag (§3.5) is active, substitute the pitcher's xFIP in place of their season ERA for all downstream calculations.

---

### 3.3 True Momentum Score (TMS)
Weighted point score across a team's last 5 games reflecting immediate form.

**Scoring:**
- Win = +3 points | Loss = −2 points
- Most recent game (Game 5) is counted at **2× weight**

**Formula:**
`TMS = G1 + G2 + G3 + G4 + (G5 × 2)`
where G = +3 (Win) or −2 (Loss), and G5 is the most recent game.

**Range:** Maximum = +18 (5W, most recent W) | Minimum = −14 (5L, most recent L)

**Travel/Fatigue modifier:** If a team traveled across 2+ time zones within the last 24 hours, reduce their TMS by 2.

**Flag:** Higher TMS = form favorite (used in §4 Driver 1)

---

### 3.4 Playoff / Game Motivation Score (PMS)
Reflects how much each team has at stake in this specific game.

`PMS = 100 (baseline) + applicable bonuses`

#### Regular Season Bonuses

| Situation | Bonus |
|-----------|-------|
| Division Race (within 3 games of lead) | +30 |
| Wild Card Race (within 3 games of WC spot) | +20 |
| Must-Win (5+ loss streak in a race) | +15 |
| Divisional Rivalry game | +15 |
| Late Season (September regular season) | +10 |
| Series Momentum (team won last 2+ in this series) | +10 |

#### Postseason Bonuses

| Situation | Bonus |
|-----------|-------|
| Elimination Game | +50 |
| Series Clinch Opportunity | +25 |
| Series Momentum (won 2+ consecutive games) | +15 |
| Divisional Rivalry | +15 |

> A team not in a race and not in the postseason uses baseline PMS = 100.
> Both bonus tables can be referenced if a regular season team is in both a division and wild card race (apply the higher of the two race bonuses, not both).

**Effect on win probability:**
`ΔPMS = Home PMS − Away PMS`
Apply `ΔPMS / 50` as a win probability percentage shift to the home team, capped at ±4%.

---

### 3.5 Regression Candidate Flag (RCF)
**Trigger:** Pitcher's season xFIP exceeds their season ERA by 1.20 or more runs.

**Effect:** Substitute xFIP for ERA in all §4 win probability calculations.

**Flag label:** "Regression Risk (Home SP)" or "Regression Risk (Away SP)"

---

### 3.6 Game Volatility Index (GVI)
Composite score from 1–100. Start at **50**, apply all applicable adjustments.

| Factor | Condition | Adjustment |
|--------|-----------|------------|
| Pitcher Volatility | Either pitcher PVS > 15 | +15 per pitcher |
| Elite Suppressor | Either pitcher ERA/xFIP < 2.50 | −15 per pitcher |
| Strong Ace | Either pitcher ERA/xFIP 2.50–3.00 | −8 per pitcher |
| Hot Offense | Either team 30-day wRC+ > 110 | +10 per team |
| Wind (blowing OUT) | 8–15 mph | +10 |
| Wind (blowing OUT) | > 15 mph | +20 |
| Wind (blowing IN) | > 8 mph | −10 |
| Cold weather | Temperature < 50°F | −10 |
| Pitcher's Park | Active park factor | −8 |
| Hitter's Park | Active park factor | +8 |
| Tight umpire zone | Pitcher-Friendly umpire | −5 |
| Wide umpire zone | Batter-Friendly umpire | +5 |
| Strong defense | Either team DRS/OAA top-third of league | −5 per team |
| High-stakes game | Postseason OR both teams in active race | +5 |
| Early Season (v2.2) | Game date April 1–14 | −5 |
| Early Season high line (v2.2) | April 1–14 AND betting line > 8.0 | additional −5 |

**Cap:** GVI cannot exceed 100 or fall below 1.

**Flags:** GVI > 65 → "OVER bias (GVI)" | GVI < 35 → "UNDER bias (GVI)"

**High-GVI / High-Line Dampener (v2.2):** When GVI > 75 AND the betting O/U line > 8.0, the GVI-driven OU-E signal is **capped at Moderate confidence** (not Strong/High). The line being above average + high volatility = unreliable OVER signal. Do not escalate to High confidence in OU-E under this condition.

---

### 3.7 Supporting Flag Definitions

**Heavy Favorite Caution Flag (HFCF):** Either team's final win probability reaches **68% or higher**.

**Team Meltdown Flag (TMF):** Either team has lost **5 or more consecutive games** entering this matchup.
> **v2.2 Win Probability Effect:** When TMF fires for the **away team**, reduce the home team's win probability by −3% (TMF team more desperate; regression to mean). When TMF fires for the **home team**, reduce the home team's win probability by −5% (loses home advantage on top of poor form). Apply before final normalization.

**High-Stakes Game Volatility (HSGV):** Active when the game is either a postseason elimination game OR a regular season game where at least one team is in a division/wild card race within 1 game of a cutoff. Replaces the postseason-only EGV from v1.0.

---

### 3.8 Early Season Calibration Flag (NEW — v2.2)

**Trigger:** Game date falls within **April 1–14** (opening two weeks of the regular season).

**When active, apply ALL of the following adjustments:**

| Adjustment | Effect |
|-----------|--------|
| Home field base bonus | Reduce from +2% to **+1%** |
| Home Fortress threshold | Raise qualifying floor to **.700** home win% (harder to trigger) |
| GVI calibration | Apply **−5 to GVI** (early-season pitching/offense less reliable = slight UNDER lean) |
| High O/U line dampener | If betting line > **8.0**, add additional **−5 to GVI** (lines set for mid-season averages) |
| RED gate | Enforce Minimum Starts Gate (§3.2) strictly — no exceptions |
| TMS early weight | If team has played **fewer than 5 regular season games**, apply TMS at **50% weight** in §4 Driver 1 |

**Flag label:** `"Early Season Calibration (April 1–14)"`

---

## 4. Hierarchical Winning Chance Synthesis

### Step 1 — Collect All Inputs
- Calculate TMS (with travel modifier), PMS, PVS, RED, RCF, GVI for both teams
- Apply RCF substitution (xFIP for ERA) if active
- Apply Bullpen Day/Opener weight shift (40% to bullpen) if active
- H2H adjustment: if one team holds ≥65% H2H win rate, apply +3% win probability to that team
- Defensive adjustment: for each team with elite DRS/OAA, apply −2% to their opponent's projected win share

### Step 2 — Check for Primary Win-Probability Overrides

> **Priority rule: WP-Override A takes precedence over WP-Override B if both fire simultaneously.**

**WP-Override A — Extreme Pitcher Quality Mismatch:**
A "Surging" ace (xFIP < 3.25, RED < −1.0) faces a "Slumping" pitcher (RED > +1.5).
→ Award the surging pitcher's team **+14% win probability** from baseline.
→ Flag: "WP-Override A fired"

**WP-Override B — Home Fortress Lock:**
An active Home Fortress team (home win% ≥ .650) faces an opponent with a road winning percentage below .500.
→ Award the home team **+10% win probability** from baseline.
→ Flag: "WP-Override B fired"

If an override fires, record the flag, apply the adjustment, then continue to PMS modifier before finalizing.

### Step 3 — Baseline & Primary Drivers (if no override dominates)

Start from **50/50 baseline**. Apply in order:

1. **Home field base:** +2% to home team (reduced to +1% if Early Season Calibration flag is active)
2. **PMS differential:** Apply ΔPMS / 50, capped at ±4%
3. **H2H adjustment:** +3% to team with ≥65% H2H record
4. **Driver 1 — Momentum:** Team with higher TMS gets +4%
   > **Away Momentum Amplifier (v2.2):** If the **away team** has a higher TMS AND the TMS gap is **5+ points** AND no WP-Override is active → award away team an **additional +2%** (total away TMS bonus = +6% before home field offsets). Flag: "Away Momentum Amplifier active".
5. **Driver 2 — Venue Control:** Home Fortress Flag active → +5% home team
6. **Defensive adjustment:** −2% per team with elite defense applied to their opponent
7. **TMF win probability adjustment:** Apply per §3.7 if TMF is active for either team

### Step 4 — Execute Conflict Protocol

**Alignment / No Conflict:**
If one team holds a clear advantage, they are the strong favorite.

**Momentum Dampener Veto:** When the TMS-favored team faces an opponent's starter with xFIP < 3.00, halve the TMS bonus from +4% to +2%.

**Direct Conflict → PDCF Triggered:**
> ⚠️ **Primary Driver Conflict Flag (PDCF):** Triggered when the road team has a higher TMS AND the home team has an active Home Fortress Flag.

**PDCF Tiebreaker Hierarchy:**

| Priority | Tiebreaker | Trigger | Award |
|----------|-----------|---------|-------|
| 1st | Bullpen Advantage | xFIP differential > 0.40 | +4% to superior bullpen team |
| 2nd | Platoon Advantage | wRC+ vs opposing handedness differential > 15 | +3% to platoon-advantaged team |
| 3rd | Situational Hitting | Better RISP wRC+ (last 30 days) | +2% to RISP-superior team |
| **Fallback** | Home default | All tiebreakers inconclusive | 52% home / 48% away |

### Step 5 — Normalize & Flag

- Normalize to sum to exactly 100
- Cap at maximum **80% / 20%**
- Check HFCF (≥68%) → flag and apply −20 confidence
- Check MCF (contradicts betting line favorite) → flag and apply −25 confidence

---

## 5. Hierarchical Over/Under Synthesis

> Evaluate **OU-A → OU-B → OU-C → OU-D → OU-E** in strict order. Stop at first trigger.

### [OU-A] Pitcher Form Dominance Protocol *(PRIMARY)*
- **Condition 1 — Surging vs Slumping:** → Lean OVER. Escalate to Strong OVER only if the slumping pitcher's team also has 15-day wRC+ > 108.
- **Condition 2 — Two Surging pitchers:** → Strong UNDER
- **Condition 3 — Both Slumping (v2.2):** Both pitchers RED > +1.5 → **Lean OVER** (both staffs leaking runs). Escalate to Strong OVER if either team's 15-day wRC+ > 108. Additionally, apply win probability equalization: subtract 8% from the favored team's win probability (both rotation liabilities = less reliable favorite). Flag: "Both SP Slumping — WP Equalized".
- **Veto (per-condition):**
  - Condition 2 (UNDER) nullified by wind blowing OUT > 15 mph → drop to OU-B
  - Condition 1 (OVER) reinforced by wind blowing OUT > 15 mph → Strong OVER, High confidence

### [OU-B] Environmental Override *(PRIMARY)*
- Wind blowing **OUT** > 8 mph → **OVER**
- Wind blowing **IN** > 8 mph → **UNDER**
- Wind blowing **OUT** > 15 mph → **Strong OVER**

### [OU-C] Offensive Volatility Override *(PRIMARY)*
- Both teams' **15-day wRC+** > 115 → **OVER**

### [OU-D] Standard Drivers
Balance the following signals:
- **Ace Suppressor Effect:** Either starter xFIP < 3.25 → UNDER bias
- **Red Hot Offense:** Either team 30-day wRC+ > 110 with avg_runs > 5.0 → OVER bias
- **Park Factor:** Hitter's Park → OVER bias | Pitcher's Park → UNDER bias
- **Temperature:** < 50°F → UNDER bias
- If signals conflict, fall through to OU-E

### [OU-E] Tiebreaker — GVI Synthesis
- GVI > 65 → **OVER**
- GVI < 35 → **UNDER**
- GVI 35–65 → Neutral — lean toward nearest active driver; if none, match betting market direction

**O/U Confidence assignment:**
- **High:** 2+ override/driver signals clearly align
- **Moderate:** 1 strong override signal or 2 conflicting drivers resolved by GVI
- **Low:** GVI tiebreaker only or unresolved conflict

**Over % conversion table:**

| Confidence | OVER % | UNDER % |
|-----------|--------|---------|
| High | 72% | 28% |
| Moderate | 61% | 39% |
| Low | 54% | 46% |

---

## 6. Confidence Scoring & Variance Flags

Start at **100 points**. Minimum score: **25**.

| Flag | Code | Deduction | Trigger Condition |
|------|------|-----------|------------------|
| Primary Driver Conflict Flag | PDCF | −30 | Road team TMS-favored + home team Home Fortress |
| Model Contradiction Flag | MCF | −25 | Final pick contradicts betting line favorite |
| Heavy Favorite Caution Flag | HFCF | −20 | Either team win probability ≥ 68% |
| Team Meltdown Flag | TMF | −20 | Either team on 5+ consecutive loss streak |
| High Volatility Index Flag | HVIF | −15 | GVI > 75 |
| High-Stakes Game Volatility | HSGV | −15 | Postseason elimination game OR both teams within 1 game of division/WC cutoff |
| Volatile Moderate Favorite | VMF (v2.2) | −10 | GVI > 70 AND final win probability 55–65% (high volatility undermines moderate favorites) |
| Early Season Data Unreliable | ESDU (v2.2) | −10 | Early Season flag active AND 2+ fields filled via knowledge-estimate (not confirmed stats) |
| Both SP Slumping | BSS (v2.2) | −10 | Both pitchers RED > +1.5 — win probability equalization applied |
| Significant Weather Risk | SWR | −10 | Precipitation probability > 40% |

> **Note:** HSGV replaces the postseason-only EGV from v1.0. It applies to high-pressure situations in both regular season and postseason.

---

## 7. Policy on Handling Missing Data

Missing data must never halt the analysis. Follow this three-tier resolution process before issuing any Data Notice:

### Tier 1 — Extract from Source Material
Pull every available value directly from the provided screenshots, images, or structured game data. This is always the highest-priority source.

### Tier 2 — Deep Knowledge Search
If a field is not visible in source material, perform a deep search through your MLB knowledge base before giving up:

| Missing Field | Knowledge Search Action |
|--------------|------------------------|
| Pitcher ERA / WHIP | Recall pitcher's current or most recent season stats by name |
| Pitcher xFIP | Recall or estimate from ERA + walk rate profile |
| Pitcher recent game log | Reconstruct last 3–5 starts from known performance trends |
| Team record / standing | Recall current season win-loss, home/away splits, games back |
| Team avg runs / batting avg | Recall team offensive profile for current season |
| Bullpen ERA / WHIP / xFIP | Recall team bullpen performance metrics for current season |
| wRC+ / OAA / DRS | Recall or estimate from known team offensive/defensive profile |
| Weather | Recall typical conditions for the specific stadium + approximate date |
| Lineup | Recall typical starting lineup and batting order for the team |
| Betting line | Estimate from pitcher quality differential and team records |

### Tier 3 — Data Notice (last resort only)
Only issue a Data Notice if Tier 1 and Tier 2 both fail to produce a reasonable value.

> **Data Notice format:** `Data Notice: [field name] not found — [metric] estimated/skipped`

**When a Data Notice is issued, note degraded confidence for:**
- Missing xFIP → use ERA as proxy; degraded RCF/RED reliability
- Missing recent game logs after knowledge search → skip PVS calculation
- Missing wRC+ → skip §5C trigger and platoon tiebreaker
- Missing bullpen xFIP → skip bullpen tiebreaker; fall to platoon tiebreaker
- Missing standings data → skip race flags; note degraded PMS

### Data Source Tracking
All outputs must include a `data_sources` record indicating which fields came from each tier:
```json
"data_sources": {
  "extracted_from_image": ["field1", "field2"],
  "filled_from_knowledge": ["field3", "field4"],
  "estimated": ["field5"]
}
```

---

## 8. Output Generation

### 8.1 Required Output Sections

1. **Season Context** — Regular Season or Postseason; active season-specific flags
2. **Flags & Scores** — all §3 metrics with computed values and triggered flags
3. **Override Status** — WP-Overrides and OU-Overrides evaluated, fired, or skipped
4. **Win Probability** — Home % and Away % (sum to 100; max 80/20)
5. **O/U Prediction** — call, confidence level, Over %
6. **Confidence Score** — final score out of 100, all deductions itemized
7. **Key Driver Narrative** — 2–3 sentences plain English
8. **Betting Strategy** — tier (Strong / Moderate / Slight / Pass) with specific recommendation
9. **Export String**

### 8.2 Export String Format

```
Away Team @ Home Team,Home Starter (Home Abbr),Away Starter (Away Abbr),Home Win %,Away Win %,O/U Line,Over % (Over/Under Text)
```

**Example (Regular Season):**
```
Red Sox @ Yankees,Cole (NYY),Sale (BOS),56%,44%,8.5,61% (Over)
```

**Example (Postseason):**
```
Dodgers @ Yankees,Cole (NYY),Yamamoto (LAD),54%,46%,7.5,61% (Over)
```

### 8.3 JSON Output Schema

```json
{
  "season_type": "Regular Season or Postseason",
  "home_team": "string",
  "away_team": "string",
  "home_starter": "Name (Hand)",
  "away_starter": "Name (Hand)",
  "home_win_pct": 52,
  "away_win_pct": 48,
  "ou_line": "7.5",
  "ou_prediction": "OVER",
  "ou_confidence": "Moderate",
  "ou_over_pct": 61,
  "confidence_score": 72,
  "confidence_deductions": ["PDCF: -30", "HVIF: -15"],
  "active_flags": ["Surging (Home SP)", "Division Race (Away)", "PDCF"],
  "active_overrides": ["None"],
  "gvi": 58,
  "home_tms": 11,
  "away_tms": 8,
  "home_pms": 130,
  "away_pms": 100,
  "home_pvs": 12.4,
  "away_pvs": 18.7,
  "home_red": -1.3,
  "away_red": 0.4,
  "pdcf_active": false,
  "key_driver": "Home pitcher surging (RED -1.3); away team in division race (+30 PMS)",
  "reasoning": "2-3 sentence plain-English summary of key factors driving the prediction.",
  "betting_recommendation": "Moderate lean: Home Team Moneyline · OVER 7.5 (Moderate)",
  "export_string": "Away @ Home,Home SP (HOME),Away SP (AWAY),52%,48%,7.5,61% (Over)"
}
```

> **Critical:** Return only valid JSON. No markdown fences, no preamble. Use `"Data Notice: [field] not found"` for unavailable fields.

---

## 9. Changelog

| Version | Changes |
|---------|---------|
| v1.0 | Initial framework — postseason only |
| v2.0 | Defined TMS/GVI formulas; fixed Over%; confidence floor=25; connected RCF; fixed §5A veto logic; wind direction spec; renamed overrides WP/OU prefix; defined HFCF/TMF thresholds; dual-override priority; PDCF fallback; connected all dead inputs |
| v2.1 | **Expanded to Regular Season + Postseason.** Season Type field added to Match ID. PMS split into Regular Season vs Postseason bonus tables. Added regular season flags: Division Race, Wild Card Race, Late Season, Must-Win, Series Momentum. GVI +5 high-stakes bonus. EGV replaced by HSGV (covers both seasons). §8 JSON schema adds season_type field. Export string examples for both seasons. |
| v2.2 | **Accuracy revision from 10-game empirical analysis (ML 30%, 7 structural flaws identified).** (1) Minimum Starts Gate on RED — prevents knowledge-fill from creating false Surging/Slumping flags when pitcher has <3 real starts. (2) §3.8 Early Season Calibration Flag (April 1–14): reduced home base +1%, raised Home Fortress threshold .700, GVI −5/−10 for high lines, TMS 50% weight for <5-game teams. (3) Away Momentum Amplifier: away team TMS lead of 5+ points awards extra +2% on top of Driver 1. (4) TMF win probability effect: now reduces favored team's win probability (−3% away TMF / −5% home TMF) in addition to confidence deduction. (5) OU-A Condition 3 — Both Slumping rule: both pitchers RED > +1.5 → Lean OVER + WP equalization −8%. (6) High-GVI/High-Line Dampener: GVI > 75 AND line > 8.0 caps OU-E at Moderate confidence. (7) Three new confidence deductions: VMF (−10), ESDU (−10), BSS (−10). |

---

## 10. Screenshot Workflow — Design Review Protocol

### 10.1 Folder Structure
All design screenshots are stored in the `/screenshot` folder at the project root.

### 10.2 Screenshot Rules
- **On every design update:** Capture exactly **3 screenshots per page** affected by the update.
- Screenshots must represent the current visual state of that page at the time of the update.
- Name format: `[page-name]_[1|2|3].[ext]` (e.g., `home_1.png`, `home_2.png`, `home_3.png`)

### 10.3 Deletion Policy
> **IMPORTANT:** Old screenshots must **never be deleted automatically.**
> Before deleting any existing screenshot(s), Claude must:
> 1. List the files that would be deleted.
> 2. **Explicitly ask the user for confirmation** before proceeding.
> 3. Only delete after the user approves.

### 10.4 Usage During Design Review
- When analyzing UI/design, load screenshots from `/screenshot` as visual reference.
- If no screenshots exist for a page being discussed, note it and prompt the user to add them.

---

*MLB Game Predictor — CLAUDE.md v2.1*
