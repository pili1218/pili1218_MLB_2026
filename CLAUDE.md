# MLB Game Predictor — Analytical Framework v3.2

> **Operational protocol for Claude Code.**
> Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.
> When analyzing an MLB matchup, follow every section in order. Do not skip steps.
> Applies to **Regular Season and Postseason**. Season-specific rules are clearly labeled.
> v3.2 — 144-game empirical refinements (2026-04-18): Temperature-sensitive April bias correction (+1.5 to +4.0 by temp, replacing flat +3.0); Gate C loosened to 4+ starts + ≥20 IP (was 6+); Gate B requires BOTH ≥5 runs AND ≥2-game win streak; P4_VETO softened for dual-ace matchups; Cold Hammer hard UNDER override (sub-50°F + wind ≥15mph = 81%); Warm Veto (≥85°F requires GVI <25 for UNDER); BSS OVER signal capped at line ≤8.5; Coors OVER requires both teams avg ≥3.5; Wrigley mandatory wind direction confirmation; April ≥9.5 OVER banned (36%); Slumping+warm+hitter park = High OVER even April; P10 gap threshold ≥1.5; max 5 bets/day cap; RED thin-sample blend for 3–5 starts.

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

**RED Reliability Blend (v3.2 — 3–5 starts):** For pitchers with 3–5 confirmed starts (satisfies RED_unavailable gate but sample is thin), blend RED at reduced weight: `RED_blended = RED × 0.5 + PVS_direction × 0.5` where PVS_direction = +1.0 if PVS > 15 (volatile trending), −1.0 if PVS < 8 (consistently low-variance). Tag as `RED_thin`. This prevents over-reliance on a 3–5 start ERA sample while retaining the directional signal. Full-weight RED resumes at 6+ confirmed starts. Flag: `"RED_thin (Home SP) — 3–5 starts, blended weight"`

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

**Early Season TMS Cap (v2.3/v2.4):**
- **< 5 games played:** Apply TMS at **0% weight** in §4 Driver 1 — ignore entirely. A 2–4 game sample is pure noise.
- **5–9 games played:** Apply TMS at **25% weight** in §4 Driver 1.
- **≥ 10 games played:** Apply TMS at full **100% weight**.

**Home TMS Dampener (v2.4):** In **April 1–30**, when the **home team** holds the TMS advantage, reduce the home team's TMS Driver 1 bonus from +4% to **+1%**. The away team's TMS advantage retains full +4% (or +6% with Away Momentum Amplifier). Empirical basis: home TMS-favored teams won only 38% vs 50% for away TMS-favored teams — home TMS is an unreliable signal in April.

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

**RCF + Slumping Combo OVER Signal (v3.0):** When RCF fires on a pitcher AND that pitcher is also Slumping (RED > +1.5), treat as a **strong OVER signal** — 65% OVER hit rate across 17 qualifying games (113-game data). Mechanism: pitcher is simultaneously overperforming their true level (ERA misleadingly good) AND currently trending down. A double vulnerability. This signal fires independently of wind and GVI — even a neutral park + calm conditions still produces 65% OVER. Apply as an OU-A Condition input; escalates to Moderate OVER confidence.
> **Flag:** `"RCF+Slumping OVER active — ERA misleading + downtrend (65% OVER, 113-game data)"`
> **Note:** This applies to the SP with the RCF flag. If both SPs have RCF+Slumping active, escalate to Strong OVER.

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
| Warm weather | Temperature ≥ 85°F | −15 |
| Pitcher's Park | Active park factor | −8 |
| Hitter's Park | Active park factor | +8 |
| Tight umpire zone | Pitcher-Friendly umpire | −5 |
| Wide umpire zone | Batter-Friendly umpire | +5 |
| Strong defense | Either team DRS/OAA top-third of league | −5 per team |
| High-stakes game | Postseason OR both teams in active race | +5 |
| Early Season (v2.2) | Game date April 1–14 | −5 |
| Early Season high line (v2.2) | April 1–14 AND betting line > 8.0 | additional −5 |
| April OVER suppression (v2.3) | Game date April 1–30 AND OVER signal active | additional −5 |

**Cap:** GVI cannot exceed 100 or fall below 1.

**Flags:** GVI > 65 → "OVER bias (GVI)" | GVI < 35 → "UNDER bias (GVI)"

**Under Heat Gate (v3.2):** When temperature ≥ 85°F, UNDER bets require GVI **< 25** (not < 35) to proceed. At ≥85°F, Under hit rate = **31%** — hot weather converts suppression setups into extra-inning slug fests. The standard GVI < 35 threshold provides insufficient protection in heat. Flag: `"WARM_VETO active — temp ≥85°F, GVI must be <25 for UNDER"`

**High-GVI / High-Line Dampener (v2.2):** When GVI > 75 AND the betting O/U line > 8.0, the GVI-driven OU-E signal is **capped at Moderate confidence** (not Strong/High).

**April O/U Confidence Hard Cap (v2.4):** When game date is **April 1–30**, cap **ALL O/U confidence at Moderate** — for both OVER and UNDER — regardless of GVI, wind, or signal count. The "High" confidence tier does not exist for O/U in April. Exception: UNDER can reach High only when **3+ suppression factors stack simultaneously** (e.g., ace xFIP < 3.00 + pitcher's park + temp < 55°F + GVI < 30). Empirical: High confidence O/U in April was 46% correct vs Moderate at 62% — the High tier was inverting accuracy.

**High-Line April OVER Signal (v3.1/v3.2):** When game date is **April 1–30** AND O/U line **9.0–9.4** → **lean OVER (Low confidence)**. OVER on 9.0+ lines in April = 64.3% overall. Exception: cancel OVER lean if BOTH confirmed SPs have xFIP ≤ 3.00 → Pass instead.

**High-Line April OVER Ban (v3.2 — NEW):** When game date is **April 1–30** AND O/U line **≥ 9.5** → **PASS** — do NOT lean OVER. OVER on ≥9.5 April lines = **36% hit rate** — the market at these extreme lines fully prices in the offense; calling OVER on top produces losses. Previously lumped with 9.0–9.4 (64.3%) but the ≥9.5 bucket is empirically inverted. Flag: `"HIGH_LINE_OVER_BAN: April line ≥9.5 → PASS (36% OVER)"`

**Wind-Cold Interaction Rule (v2.3):** When wind blows OUT AND temperature < 60°F, **cancel the wind OVER bonus entirely** — cold air kills ball carry. Fall through to OU-D/OU-E instead. Wind IN is still valid regardless of temperature.

**xFIP Estimation Gate (v2.5):** When a pitcher's xFIP is knowledge-estimated rather than confirmed from current-season game logs, that pitcher's xFIP may still drive O/U direction but **cannot elevate O/U confidence to High**. Cap at Moderate for any call where the primary suppressor signal relies on an estimated xFIP. Tag the pitcher as `xFIP_estimated`. Applies to both UNDER and OVER directions.
> **Combined Estimation Cap (v2.5):** When 2+ key inputs (xFIP, RED, 30-day wRC+) are knowledge-estimated for either team, cap O/U confidence at Moderate regardless of direction or GVI value. Empirical basis: all 5 UNDER High misses had estimated xFIP as the primary GVI suppressor — average actual total was 11 runs on lines of 7.5–8.0.

---

### 3.7 Supporting Flag Definitions

**Heavy Favorite Caution Flag (HFCF):** Either team's final win probability reaches **68% or higher**.

**Team Meltdown Flag (TMF):** Either team has lost **5 or more consecutive games** entering this matchup.
> **v2.2 Win Probability Effect:** When TMF fires for the **away team**, reduce the home team's win probability by −3% (TMF team more desperate; regression to mean). When TMF fires for the **home team**, reduce the home team's win probability by −5% (loses home advantage on top of poor form). Apply before final normalization.

**High-Stakes Game Volatility (HSGV):** Active when the game is either a postseason elimination game OR a regular season game where at least one team is in a division/wild card race within 1 game of a cutoff. Replaces the postseason-only EGV from v1.0.

**FORTRESS + TMF Combo Flag (FTMF — v2.9):** The home team has an active **Home Fortress Flag** (home win% ≥ .650) AND the opposing (away) team has an active **Team Meltdown Flag** (5+ consecutive losses).
> **Effect:** Strong secondary Under confirmation signal. 73% Under hit rate across 8 qualifying games in 104-game dataset (6W/2L). When FTMF fires AND an Under is already directionally indicated, escalate Under confidence to Moderate if currently Low. Does **not** substitute for Gate C — the home SP must still meet sub-2.50 ERA + 4+ starts + ≥20 IP.
> **Flag:** `"FORTRESS+TMF active — secondary Under signal (73% hit rate, 104-game data)"`. Tag as `FTMF_MATCH` in betting flags output.

---

### 3.8 Early Season Calibration Flag (v2.3 expanded)

**Tier A — April 1–14 trigger** (opening two weeks):

| Adjustment | Effect |
|-----------|--------|
| Home field base bonus | **−2% to home team** (48% home / 52% away baseline) — empirical data shows away teams winning **58%** in April; prior 0% was not enough correction |
| Home Fortress threshold | Raise qualifying floor to **.700** home win% (harder to trigger) |
| Home Bonus Accumulation Cap | Total home bonuses from §4 Step 3 capped at +8% above baseline (see §4) |
| GVI calibration | Apply **−5 to GVI** |
| High O/U line dampener | If betting line > **8.0**, add additional **−5 to GVI** |
| RED gate | Enforce Minimum Starts Gate (§3.2) strictly — no exceptions |
| TMS early weight | Apply per §3.3 tiered cap: 0% if <5 games, 25% if 5–9 games |
| Home TMS Dampener | Home TMS advantage capped at +1% (not +4%) — see §3.3 |
| O/U confidence cap | Cap ALL O/U confidence at **Moderate** — High tier unavailable (see §3.6) |
| xFIP Estimation Gate | Estimated xFIP cannot drive High confidence — cap at Moderate (see §3.6) |
| High-line OVER lean (v3.2) | O/U line **9.0–9.4** → OVER (Low confidence). O/U line **≥9.5 → PASS** (OVER banned, 36% hit rate). See §3.6. |
| 7.5–7.9 UNDER ban (v3.1) | O/U line 7.5–7.9 → PASS on UNDER — 27.3% hit rate (avg actual 10.3 runs). No bet. |
| Wind-Cold gate | Cancel wind OVER bonus if temp < 60°F (see §3.6 Wind-Cold Interaction Rule) |
| No-Edge Pass | Final win probability 47–53% → betting recommendation = Pass (no ML edge) |

**Tier B — April 15–30 trigger** (remainder of April):

| Adjustment | Effect |
|-----------|--------|
| Home field base bonus | **−1% to home team** (49% home / 51% away baseline) |
| Home Bonus Accumulation Cap | Total home bonuses from §4 Step 3 capped at +8% above baseline (see §4) |
| TMS early weight | Apply per §3.3 tiered cap: 0% if <5 games, 25% if 5–9 games |
| Home TMS Dampener | Home TMS advantage capped at +1% (not +4%) — see §3.3 |
| O/U confidence cap | Cap ALL O/U confidence at **Moderate** — High tier unavailable |
| xFIP Estimation Gate | Estimated xFIP cannot drive High confidence — cap at Moderate |
| High-line OVER lean (v3.2) | O/U line **9.0–9.4** → OVER (Low confidence). O/U line **≥9.5 → PASS** (OVER banned, 36% hit rate). See §3.6. |
| 7.5–7.9 UNDER ban (v3.1) | O/U line 7.5–7.9 → PASS on UNDER — 27.3% hit rate (avg actual 10.3 runs). No bet. |
| Wind-Cold gate | Cancel wind OVER bonus if temp < 60°F |
| No-Edge Pass | Final win probability 47–53% → betting recommendation = Pass (no ML edge) |

**Flag label:** `"Early Season Calibration (April 1–14)"` or `"April Calibration (April 15–30)"`

---

### 3.9 Variance Realism & Bet Eligibility (v2.6)

#### MLB Total Variance Acknowledgment
The standard deviation of MLB game totals is approximately **4.5 runs per game**. A model-projected edge of 1.2–1.9 runs above/below the O/U line represents only **0.25–0.4 standard deviations** — a theoretical win rate of ~53–56%. This edge only materializes over 100–200 bets; in any 5-game sample, 20%–80% accuracy is normal random variance. This context must inform confidence scoring and bet selection.

#### O/U Bet Gap Minimum (v2.6)
Before issuing any O/U betting recommendation (Slight or above), compute the **projected game total**:

`Projected Total = (Home avg_runs + Away avg_runs) × Park Factor multiplier`

Apply any bullpen adjustment: if either bullpen ERA > 4.50, add +0.5 runs; if either bullpen ERA < 3.50, subtract 0.3 runs.

**April Bias Correction (v3.2 — temperature-sensitive):** April games run above model baseline, but the excess varies with temperature. After computing Projected Total + bullpen adjustment, apply the temperature-appropriate April bias:

| Temperature (game-time) | April Bias | Context |
|------------------------|-----------|---------|
| < 50°F (cold) | **+1.5 runs** | Cold suppresses scoring; flat +3.0 was over-correcting in cold games |
| 50–64°F (cool) | **+2.5 runs** | Moderate correction |
| 65–74°F (mild) | **+3.0 runs** | Standard April baseline |
| ≥ 75°F (warm) | **+3.5 runs** | Warm weather inflates scoring |
| ≥ 85°F (hot) | **+4.0 runs** | Maximum heat inflation |
| **April 1–14 (any temp)** | **+4.0 runs** | Opening two weeks: additional early-season variance regardless of temperature |

- **May onward: add +2.0 runs** to Projected Total (unchanged)

When temperature is unavailable, default to +3.0 (mild assumption). Apply this correction before all gate checks. Empirical basis: 144-game dataset confirms the flat +3.0 was under-correcting in warm conditions and over-correcting in cold conditions.

**Gate:** Only issue an O/U bet recommendation if `|Projected Total (bias-corrected) − O/U Line| ≥ 2.0 runs`. If gap < 2.0 runs → O/U betting recommendation = **Pass (insufficient gap)**. The O/U direction prediction is still output (for tracking), but no active bet is recommended.

**P10 Gap Exception (v3.2):** When **P10_MATCH is active** (corrected projected total ≤ 6.5), the minimum gap threshold is reduced to **≥ 1.5 runs**. P10's mechanical low-total confirmation provides sufficient structural edge at a tighter gap than general O/U bets require.

> Empirical basis: 1.2–1.9 run gaps produce only ~53–56% theoretical edge — statistically indistinguishable from noise in single-game samples. A 2.0-run minimum represents ~0.44 standard deviations, giving a more meaningful theoretical win rate of ~57–59%.

#### Under 7-Gate System (v3.0)

Before recommending any UNDER bet, **ALL 7 gates must pass**. Any single gate failure = Pass (skip Under) except Gate F which halves stake rather than blocks. No exceptions on Gates 0 and A–E.

| Gate | Check | Pass Condition | Failure Action |
|------|-------|---------------|----------------|
| **Gate 0 — Home Offensive Surge (NEW v3.0)** | Home team avg_runs over their last 3 games | < 6.0 runs/game | **Veto ALL Under bets** — home offence surge kills Under even with elite home SP. 0% Under hit rate (4/4 cases) in 113-game data. Hard stop regardless of pitcher quality. |
| **Gate A — Environmental** | Previous day's MLB slate avg total | **≤ 10 runs/game (inclusive — ≥10.0 blocks)**. *Dual-day check (v3.2):* if EITHER of the last 2 days averaged >9.5 runs, halve stake (do not skip). | Skip **all** Unders if prev day ≥10.0; halve stake if either of last 2 days >9.5 |
| **Gate B — Both Teams Momentum** | Did either home OR visiting team score ≥5 runs in a WIN in the last 2 days **AND** are they on a ≥2-game win streak? | Neither team meets **both** conditions (≥5 runs + ≥2-win streak) | Skip Under (or $50 max if home SP ERA < 2.50). The win streak requirement filters out isolated high-scoring games that don't reflect sustained hot offence. |
| **Gate C — Home SP Quality** | Home SP 2026 ERA, starts, and IP | Sub-2.50 ERA + **4+ verified 2026 starts AND ≥20 IP** | Skip — ERA before 4 starts + 20 IP is unreliable. Prior 6-start gate was too strict, blocking 11/18 profitable Under bets (61%). 4+ starts + ≥20 IP restores access to legitimate early-ace starts while maintaining reliability. **W-ACE✗ flag raised: hard stop.** |
| **Gate D — April Visiting Filter** | *(April 1–30 only)* Is visiting team ATH or WAS? | Yes (Oakland or Washington) | Skip Under against all other visitors in April |
| **Gate E — Estimate Gate** | Bias-corrected projected total | +3.0 (April) or +2.0 (May+) added to raw est ≤ **6.5** | Skip — estimate too high; likely lands in 12-run loss category |
| **Gate F — ESDU Stake Reducer** | *(April only)* Is ESDU flag active (2+ knowledge-estimated fields)? | ESDU not active = full stake | **Halve stake** (do not skip) — 65% Over rate when ESDU active in April. If P1/P2/P11 pattern active: reduce to $50/$37.50/$50 respectively. Does not block the Under. |

> **Both RED_unavailable Ban (v3.0):** When **both** starting pitchers have `RED_unavailable` status (< 3 confirmed starts each), O/U accuracy drops to **38%** across 22 games — well below breakeven. **Pass all O/U bets** in this scenario. Exception: P10 (bias-corrected projected total ≤ 6.5) may still fire even without RED data, but requires both teams' avg_runs to be extremely low. Outside of P10, any game where both pitchers are sub-3 starts = automatic O/U pass.
> **Flag:** `"BOTH_RED_UNAVAIL: both SPs <3 starts — O/U 38%, pass all O/U (exception: P10 ≤6.5)"`

> **Both xFIP Estimated + Sub-3 Starts (v3.2):** When **both** SPs have knowledge-estimated xFIP (not confirmed from current-season logs) **AND** both have < 3 confirmed starts, do **not even output a directional O/U prediction** — output Pass with no direction. This is a stricter variant of BOTH_RED_UNAVAIL: with no confirmed xFIP and no ERA sample, the GVI calculation is structurally unreliable. O/U accuracy in this dual-blind scenario = 38%. Unlike standard BOTH_RED_UNAVAIL (which allows tracking output), this scenario warrants complete suppression.
> **Flag:** `"BOTH_XFIP_BLIND: both SPs estimated xFIP + <3 starts — no O/U direction (38% accuracy)"`

> **Dual PVS > 15 Skip (v3.0):** When **both** starting pitchers have PVS > 15, O/U accuracy = **41%** across 14 games — below breakeven. Skip O/U bets when dual PVS > 15 is active, unless a primary signal (P10, RCF+Slumping, Wind OUT > 15mph) independently justifies the bet. Single PVS > 15 still adds +15 to GVI per §3.6 — this skip only applies when BOTH pitchers are high-variance.
> **Flag:** `"DUAL_PVS_SKIP: both SPs PVS >15 — O/U 41%, skip unless primary signal present"`

> **Bimodal Under Distribution (v2.8/v2.9):** Under wins avg 5.2 total runs. Under losses avg 12.1 runs. There is almost no middle ground — it either wins comfortably or loses catastrophically. A corrected estimate above 5.5 is more likely to land in the 12-run category. Only bet Under when corrected est ≤ 5.5 (high conviction) or ≤ 6.5 (moderate — Gates A–F evaluated).

#### Rain Policy (v2.8 — Revised)

Previous threshold (40%) was too conservative and caused missed profitable Under wins (NYM@LAD 4 total was skipped at 73% rain). Revised thresholds:

| Precipitation Probability | Action |
|--------------------------|--------|
| **≥ 85%** | Skip bet entirely — void risk too high |
| **65–84%** | Halve stake (bet $37.50 if normal unit is $75) |
| **< 65%** | Normal stake — proceed |

> **LAD Home Factor (v2.8):** Dodger Stadium with any pitcher is a natural Under environment due to park factor + defence. Do not skip on rain alone below 85% when LAD is home.

#### Doubleheader Game 2 Flag (v2.6)
**Trigger:** Game is identified as the **second game of a doubleheader** (DH G2).

**Effect:**
- **OVER lean applied** — tired bullpens in DH G2 give up more runs, not fewer. Both teams' bullpen depth is depleted from Game 1.
- **Never recommend UNDER in DH G2** — regardless of GVI, OU-A pitcher form, or low line. Starter length increases in DH G2 do not suppress runs; they shift liability from bullpen to a potentially fatigued starter.
- Add +8 to GVI for DH G2 (replaces any neutral bullpen assumption).
- Flag: `"DH G2 — OVER lean applied"`

**Identification:** Flag DH G2 when game notes, context, or scheduling indicates same-day doubleheader Game 2.

#### Wind-Ace Interaction Rule (v2.6)
Wind blowing **OUT** > 8 mph activates OU-B OVER signal **only when the starting pitchers are mid-tier or weaker**. When an **ace-tier starter** (xFIP ≤ 3.25 confirmed, or ERA ≤ 2.80) is pitching, wind OUT is **cancelled as an OVER signal** — elite pitchers suppress ball carry through controlled pitch profiles regardless of wind conditions.

**Rule:**
- Wind OUT > 8 mph AND **both SPs xFIP > 3.50** → OU-B OVER fires normally
- Wind OUT > 8 mph AND **either SP xFIP ≤ 3.25** → OU-B OVER signal is **reduced to OU-D input only** (not a primary trigger)
- Wind OUT > 8 mph AND **both SPs xFIP ≤ 3.25** (dual aces) → OU-B OVER signal is **cancelled entirely** → fall through to OU-D
- Wind IN > 8 mph is **not affected** by pitcher quality — suppressive wind works regardless of pitcher tier

> Empirical basis: TOR@CWS had 16–17 mph confirmed wind OUT. Total = 3 runs. Wind adds ~0.4 runs on average across thousands of games — a signal completely invisible when elite pitchers are dealing.

**Flag:** `"Wind-Ace Veto active"` when wind OVER cancelled by ace-tier SP.

---

### 3.10 Pattern Betting Policies (v2.9)

Derived from **104-game empirical dataset** (ML moderate-conf record: 57.4% across 54 games; O/U record 31–43 = 41.9% overall, Modified O/U 58.5%; break-even needed 52.7%).

> **⚠️ MANDATORY:** Before issuing any betting recommendation in §8, evaluate ALL 11 patterns below. Output the **Betting Decision Flags** report (12 flags) so the user can see which gates passed/failed and make their own decision.

#### Pattern Table

| # | Pattern | Games | Hit Rate | Policy | Flag |
|---|---------|-------|----------|--------|------|
| 1 | Dome stadium + dual elite SP (both xFIP ≤ 3.25 or ERA ≤ 2.80) | 6 | 67% | **ACTIVE — Pattern A** | `P1_MATCH` |
| 2 | Home ace SP (ERA < 2.50 + **4+ 2026 starts + ≥20 IP**) vs **ATH or WAS visiting** *(April only: weakest offences only)* | ~12 | **~67%** | **ACTIVE — Pattern B** (April: ATH/WAS only; all other visitors → skip Under) | `P2_MATCH` |
| 3 | Temperature < 45°F + natural grass field + no wind OUT | 8 | **33%** | **SUSPENDED (v2.8)** — 33% hit rate; do not use until May retest | `P3_SUSPENDED` |
| 4 | Road ace pitcher (xFIP ≤ 3.25) vs home offence | 10 | 50% | **BANNED** — do not include in any bet recommendation | `P4_VETO` |
| 5 | O/U confidence score in 50–64 range | 42 | 58.5% | **TARGET ZONE ONLY** — all O/U bets must fall here | `P5_ZONE` |
| 6 | **Moderate confidence ML bet (50–64 conf)** | 54 | **57.4%** | **ACTIVE (v2.9 updated)** — bet ML at $75 when confidence 50–64; 104-game data confirms positive EV | `P6_ML_MOD` |
| 7 | Hot batting team (team avg_runs ≥ 5.0 AND on a win streak of 3+) | 7 | 14% | **HARD SKIP** — output warning, require user confirmation | `P7_SKIP` |
| 8 | Target Field (MIN), Progressive Field (CLE) cold UNDER, or **Yankee Stadium (NYY) April UNDER** | 5/6 | **22% / 17%** | **PERMANENTLY BANNED** — Target/Progressive re-confirmed at 22%; Yankee Stadium April Under 17% (1/6 games) added v3.0 | `P8_BAN` |
| 9 | High confidence label (confidence score ≥ 65) | 8 | 25% | **BANNED** — cap effective bet confidence at 64 max | `P9_BAN` |
| 10 | UNDER when projected total ≤ 6.5 runs | 23 | **74%** | **Strong signal** — require projected total ≤ 6.5 to activate. *Updated v3.0: prior 100% claim across 27 games corrected to 74% across 23 games — still strong but no longer perfect* | `P10_MATCH` |
| 11 | LAD home ace SP (Ohtani, Yamamoto, or Sasaki; ERA < 2.50 + **4+ verified 2026 starts + ≥20 IP**) | 5 | **80%** | **ACTIVE — Pattern C (v2.9)** — LAD home ace = highest-priority Under target; Ohtani qualifies ~May 4–6 | `P11_LAD_ACE` |

#### Pattern Flag Definitions & Effects

**`P1_MATCH` — Dome + Dual Elite SP:**
- Trigger: Indoor/dome stadium AND both starting pitchers have xFIP ≤ 3.25 (or ERA ≤ 2.80 if xFIP unavailable).
- Effect: Elevate to Pattern A tier bet. Strong UNDER signal — dual aces in a controlled environment suppress run totals.
- Output: `"P1_MATCH: Dome + dual elite SP — Pattern A eligible (UNDER lean)"`

**`P2_MATCH` — Home Ace vs Weakest Visiting Offences (v2.8 narrowed):**
- Trigger: Home SP ERA < 2.50 (2026 season, **4+ verified starts + ≥20 IP**) AND visiting team is **ATH (Oakland Athletics) or WAS (Washington Nationals)** — the two weakest offences in MLB.
- Effect: Pattern B tier. ~67% Under hit rate. Only valid against these two specific visitors. All other visiting teams in April = skip Under entirely.
- Output: `"P2_MATCH: Home ace vs ATH/WAS — Pattern B eligible (UNDER lean, ~67% hit rate)"`
- Output if visitor not ATH/WAS: `"P2_MATCH: visiting team not ATH/WAS — skip Under in April (pattern too risky vs other offences)"`

**`P3_SUSPENDED` — Cold Natural Grass UNDER (SUSPENDED v2.8):**
- Trigger: Temperature < 45°F AND natural grass field AND no wind blowing OUT > 5 mph.
- Effect: **SUSPENDED** — 77-game data shows 33% hit rate vs originally claimed 60%. Do not use until May retest with larger sample. Log as informational only.
- Output: `"P3_SUSPENDED: Cold natural grass UNDER — SUSPENDED (33% hit rate, 77-game data). Informational only."`

**`P4_VETO` — Road Ace vs Home Offence (SOFTENED v3.2):**
- Trigger: Away SP xFIP ≤ 3.25 (or ERA ≤ 2.80) pitching on the road against the home team.
- **Dual-Ace Exception (v3.2):** If the **home SP also** has xFIP ≤ 3.25 and meets Gate C (4+ verified starts + ≥20 IP), do **NOT** apply the full veto — route to P1_MATCH (dome dual-ace) or P2_MATCH (home ace vs ATH/WAS) instead. The prior full ban was blocking 7/9 profitable Under bets (78%) in dual-ace matchups where the Under edge is real regardless of which ace is home vs away.
- Effect when no exception (single road ace, home SP is not ace-tier): **Ban Under O/U** — do not recommend any Under bet. ML still eligible at conf 50–69.
- Output (veto active): `"P4_VETO: Road ace vs home offence — UNDER BAN active. ML still eligible."`
- Output (dual-ace exception): `"P4_VETO bypassed — dual-ace matchup, routing to P1/P2. Home SP xFIP ≤3.25 + Gate C met."`

**`P5_ZONE` — Confidence Zone (O/U and ML):**
- Trigger: Final confidence score falls between 50–64 (O/U) or 50–69 (ML).
- Effect O/U: **Only valid zone for active O/U bets** is 50–64. Confidence < 50 → Pass. Confidence ≥ 65 → P9_BAN caps O/U.
- Effect ML: Valid ML zone is 50–69 (per P6_ML_MOD v3.1). ML at 65–69 is the strongest performance zone (66.7%).
- Output: `"P5_ZONE: Conf [X] — O/U eligible (50–64) ✓ / ML eligible (50–69) ✓"`

**`P6_ML_MOD` — ML Bet in Profitable Zone (v3.1 updated):**
- Trigger: Model confidence is in the **50–69 range** (expanded from 50–64 — see P9_BAN v3.1 update).
- **Confidence sub-zones:** 50–59 = 57.7–60.0% ML hit rate; 60–64 = 16.7% (⚠️ weak — only 6 games, small sample but avoid if possible); 65–69 = **66.7% (10/15)** — strongest ML zone.
- Effect: **ML bet is eligible at $75.** 128-game data: overall ML 53.9%; conf 50–64 = 53.8%; conf 65–69 = 66.7%.
- Do NOT bet ML at confidence < 50 (marginal edge) or ≥ 70 (25% hit rate, 4 games — small sample, avoid).
- **Combo Bet (v2.9):** When the ML pick AND Under direction both point the same team, add a **$25–30 combo or same-direction side bet** on top of standard sizing. Only valid when Under passes all gates AND Under direction aligns with the ML predicted winner.
- Output: `"P6_ML_MOD: ML eligible — $75 bet (conf [x] in 50–69 zone)"`
- If confidence < 50 or ≥ 70: `"P6_ML_MOD: Outside 50–69 zone — no ML bet"`

**`P7_SKIP` — Hot Batting Team Hard Skip:**
- Trigger: Either team has a 30-day avg_runs ≥ 5.0 AND is currently on a win streak of 3 or more games.
- Effect: **HARD SKIP WARNING** — halt the bet recommendation and flag for user review. Do not auto-recommend a bet. The hot batting team pattern inverts expected accuracy (14% hit rate, -38.7% ROI).
- Output: `"⚠️ P7_SKIP: Hot batting team detected ([Team]). HARD SKIP — review before betting."`

**`P8_BAN` — Venue Under Ban (PERMANENTLY BANNED, expanded v3.0):**
- **Trigger A:** Game played at Target Field (MIN Twins) OR Progressive Field (CLE Guardians) AND temperature < 55°F AND UNDER is the predicted direction.
- **Trigger B (NEW v3.0):** Game played at Yankee Stadium (NYY home) AND game date is April 1–30 AND UNDER is the predicted direction. 17% Under hit rate (1/6 games) — Yankee Stadium in April is a structural OVER environment regardless of pitching quality.
- Effect: **Permanently ban these venue+condition UNDER combinations.** Redirect to Pass.
- Output: `"P8_BAN: [Target/Progressive Field cold UNDER / Yankee Stadium April UNDER] — PERMANENTLY BANNED."` 

**`P9_BAN` — High Confidence Cap for O/U Bets (BAN ≥ 65, O/U only):**
- Trigger: Final confidence score ≥ 65 AND bet type is **O/U**.
- Effect: **Cap effective O/U betting confidence at 64.** High O/U confidence (≥65) performed at 47.1% hit rate — below the 52.4% breakeven. Do not place O/U bets above the Moderate zone.
- **ML exception (v3.1):** P9_BAN does **NOT** apply to ML bets. ML at conf 65–69 = **66.7% (10/15 games)** — the highest-performing ML zone in the 128-game dataset. ML bets at conf 65–69 are eligible at $75. Do not bet ML at conf ≥ 70 (1/4 = 25% — small sample but avoid).
- Output: `"P9_BAN: Conf ≥ 65 — O/U capped at 64 ✗ / ML at 65–69 still eligible ✓"`

**`P10_MATCH` — Projected Total ≤ 6.5 UNDER:**
- Trigger: Projected game total (calculated per §3.9) is ≤ 6.5 runs AND predicted direction is UNDER.
- Effect: **Strong UNDER signal** — **74% hit rate across 23 games** (v3.0 corrected from prior 100%/27-game claim). Escalate UNDER confidence to Moderate if currently Low (still subject to April caps). Still the single most reliable mechanical gate for Under bets — cap stake at $50 regardless of confidence (mechanical not structural).
- Output: `"P10_MATCH: Projected total ≤ 6.5 — Strong UNDER signal (74% historical, 23 games). Confidence escalated."`

**`P11_LAD_ACE` — LAD Home Ace Start (NEW v2.9):**
- Trigger: Game at Dodger Stadium (LAD home) AND home SP is **Shohei Ohtani, Yoshinobu Yamamoto, or Roki Sasaki** AND SP meets Gate C requirements (ERA < 2.50 + **4+ verified 2026 starts + ≥20 IP**).
- Effect: **Pattern C tier Under bet.** 80% Under hit rate across 5 qualifying games (4W/1L) in 104-game dataset. One loss: Ohtani Apr 15 vs NYM (10 runs allowed — outlier start). When Gate C is met for any LAD ace, this is the **highest-conviction Under signal** in the system.
- **Start count tracking:** Ohtani qualifies approximately May 4–6 (monitor starts 4–5–6 closely). Yamamoto and Sasaki qualifying depends on their individual start counts — verify 6+ verified 2026 starts before triggering.
- **Sizing:** Pattern C Under = **$100 unit** (above Pattern B $75, below Pattern A $150). Apply Gate F stake halve if ESDU active ($50).
- Output: `"P11_LAD_ACE: LAD home [SP name] — Pattern C eligible (UNDER, 80% hit rate, 104-game data)"`
- If SP hasn't reached 6 starts: `"P11_LAD_ACE: [SP name] has [n] verified 2026 starts — Gate C not met, pattern inactive"`

#### Betting Decision Evaluation Order (v2.9 — §8 checklist)

Before finalizing any betting recommendation, evaluate in this order:

**For ML bet:**
1. **CONF_ZONE** — Is confidence 50–69? → ML bet $75 (P6_ML_MOD). Note: 60–64 is weak (16.7%, small sample); 65–69 is the strongest zone (66.7%). Conf ≥ 70 or < 50 → no ML bet.
   - If ML and Under point same direction → also evaluate **Combo Bet** (+$25–30).

**For Under bet (all 7 gates + bans):**
2. **P8_BAN** — venue Under ban (Target/Progressive Field cold; Yankee Stadium April) → ban
3. **P4_VETO** — road ace (away SP xFIP ≤ 3.25) → ban all bets on game
4. **BOTH_RED_UNAVAIL** — both SPs < 3 starts → pass O/U (exception: P10 ≤ 6.5)
5. **DUAL_PVS_SKIP** — both SPs PVS > 15 → skip O/U unless primary signal present
6. **GATE_0** — Home offensive surge: home avg_runs last 3G ≥ 6.0 → veto all Unders (hard stop)
7. **GATE_A** — Environmental: prev-day slate avg **≥ 10.0** runs → skip all Unders
8. **GATE_B** — Both teams momentum: either team ≥5 runs in win last 2 days → skip/reduce
9. **GATE_C** — Home SP quality: sub-2.50 ERA + **4+ verified starts + ≥20 IP** → must pass (W-ACE✗ = hard stop)
10. **GATE_D** — April visiting filter: must be ATH or WAS in April → else skip
11. **GATE_E** — Estimate gate: corrected est (raw + 3.0) ≤ 6.5 → must pass
12. **GATE_F** — ESDU stake reducer: if ESDU active in April → halve stake (does not block bet)
13. **P9_BAN** — cap confidence at 64 if score ≥ 65
14. **P1/P2/P11 MATCH** — check positive patterns; P3 suspended
15. **FTMF_MATCH** — check FORTRESS+TMF combo; if active → escalate Under confidence to Moderate if currently Low

> **Sizing tiers (v2.9):** ML bet = $75 flat (moderate conf). Combo bet = +$25–30 when ML+Under align. Pattern A Under ($150) = P1_MATCH only. Pattern B Under ($75) = P2_MATCH (home ace vs ATH/WAS). Pattern C Under ($100) = P11_LAD_ACE (LAD home Ohtani/Yamamoto/Sasaki when Gate C met). Standard Under ($50) = all gates pass, no pattern match. Gate F halve = reduce whichever unit is active by 50%. Rain halve = apply on top of Gate F if both active. Adjust to actual bankroll units.

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

1. **Home field base:** +2% to home team. **April adjustments (v2.4):**
   - April 1–14: **−2% to home team** (48/52 home/away baseline) — away teams won 58% empirically
   - April 15–30: **−1% to home team** (49/51 home/away baseline)
2. **PMS differential:** Apply ΔPMS / 50, capped at ±4%
3. **H2H adjustment:** +3% to team with ≥65% H2H record
4. **Driver 1 — Momentum:** Team with higher TMS gets +4%, subject to:
   - **Early Season TMS cap** (§3.3): 0% weight if team <5 games, 25% if 5–9 games
   - **Home TMS Dampener (v2.4):** In April 1–30, if the HOME team has higher TMS → award only **+1%** to home team (not +4%)
   > **Away Momentum Amplifier (v2.2):** If the **away team** has a higher TMS AND the TMS gap is **5+ points** AND no WP-Override is active → award away team an **additional +2%** (total away TMS bonus = +6% before home field offsets). Flag: "Away Momentum Amplifier active".
5. **Driver 2 — Venue Control:** Home Fortress Flag active → +5% home team
6. **Defensive adjustment:** −2% per team with elite defense applied to their opponent
7. **TMF win probability adjustment:** Apply per §3.7 if TMF is active for either team

> **Home Bonus Accumulation Cap (v2.5):** In **April 1–30**, after applying all Step 3 items above, sum all bonuses added to the home team's probability above the April baseline (48% Tier A / 49% Tier B). If total home bonus exceeds **+8%**, trim the excess. Discard the least impactful bonus first (Defense → H2H → PMS → Fortress). This cap does **not** apply to WP-Override A (pitcher mismatch is a genuine signal). Empirical basis: model was picking HOME 68.8% of the time vs 46.9% actual home wins — stacked bonuses were overwhelming the April away corrections.

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
- **No-Edge Pass Threshold (v2.5):** When the final home win probability falls in the **47–53% range** after all adjustments and normalization, set `ml_edge = "no-edge"`. The ML betting recommendation must be **Pass** — do not force a side. The O/U prediction still runs normally. Empirical basis: close games (45–55% model win%) went 1-for-8 (12.5%) — worse than random, indicating the model has zero edge in this range.

---

## 5. Hierarchical Over/Under Synthesis

> **⚠️ MANDATORY APRIL O/U GATE (v2.5):** Before evaluating any OU-A through OU-E signal, check the game date. If **April 1–30**: record `april_ou_gate = ACTIVE`. After the signal direction is determined from whichever OU step triggers first, **force confidence to Moderate** — do not output High. Only exception: UNDER may reach High if 3+ suppression factors stack **with confirmed (not estimated) data** simultaneously: confirmed ace xFIP < 3.00 from current-season starts + pitcher's park + temp < 55°F + GVI < 30. This gate is mandatory — apply it last, after determining direction, before writing the output. Empirical: 16 of 16 April predictions violated this cap; High O/U in April was 47.1% vs Moderate at 61.5%.

> Evaluate **OU-A → OU-B → OU-C → OU-D → OU-E** in strict order. Stop at first trigger.

> **Cold Hammer Override (v3.2 — HARD OVERRIDE before OU-A):** When temperature **< 50°F** AND wind ≥ **15 mph** (any direction), apply an immediate **Strong UNDER** override — **81% Under hit rate** across qualifying games (144-game data). This fires BEFORE OU-A and supersedes all directional signals. No other checks needed; proceed directly to gate eligibility. Conditions: cold air + high wind = run suppression regardless of pitcher form, park, or GVI. Flag: `"COLD_HAMMER active — temp <50°F + wind ≥15mph → Strong UNDER (81%, hard override)"`. Not subject to the April High Confidence Hard Cap — this pattern is strong enough to override. Still subject to Gate 0, Gate A, Gate C, Gate E, and venue bans.

### [OU-A] Pitcher Form Dominance Protocol *(PRIMARY)*
- **Condition 1 — Surging vs Slumping:** → Lean OVER. Escalate to Strong OVER only if the slumping pitcher's team also has 15-day wRC+ > 108.
- **Condition 2 — Two Surging pitchers:** → Strong UNDER. **April cap (v2.4):** Capped at Moderate confidence in April per §3.6.
- **Condition 3 — Both Slumping (v2.2):** Both pitchers RED > +1.5 → **Lean OVER** (both staffs leaking runs). Escalate to Strong OVER if either team's 15-day wRC+ > 108. Additionally, apply win probability equalization: subtract 8% from the favored team's win probability (both rotation liabilities = less reliable favorite). Flag: "Both SP Slumping — WP Equalized".
  > **BSS Line Cap (v3.2):** BSS OVER signal only fires (and escalates to OVER direction) when the **O/U line is ≤ 8.5**. When line > 9.0, the market has already priced in the expected pitching volatility — BSS edge disappears at high lines (41% hit rate at line >9.0). Apply −20 confidence if BSS fires but line > 9.0, and cap at PASS. Flag: `"BSS_LINE_CAP active — line >9.0, BSS signal suppressed (-20 conf)"`
- **Condition 4 — Slumping Home SP + Heat + Hitter's Park (v3.2 NEW):** Home SP is Slumping (RED > +1.5) AND temperature ≥ 75°F AND park classification = Hitter's Park → **Strong OVER** — **87% OVER hit rate**. This combo overrides the April High Confidence Hard Cap: escalate to **High OVER** even in April when all three conditions are confirmed. Mechanism: slumping pitcher + heat-inflated ball carry + offensive park = structural OVER condition. Flag: `"SLUMP+HEAT+PARK: home SP slumping + ≥75°F + hitter park → Strong/High OVER (87%)"`
- **Veto (per-condition):**
  - Condition 2 (UNDER) nullified by wind blowing OUT > 15 mph → drop to OU-B
  - Condition 1 (OVER) reinforced by wind blowing OUT > 15 mph → Strong OVER, High confidence
- **Single-Ace UNDER April Cap (v2.4):** In April 1–30, when UNDER direction is driven **solely by one surging pitcher** (Condition 1 or 2 with a single ace, not dual aces), cap UNDER confidence at **Moderate**. High UNDER in April requires 3+ suppression factors stacking simultaneously (ace xFIP < 3.00 + pitcher's park + temp < 55°F or dual aces). Empirical: 3 of 4 single-ace High UNDER calls in April failed, with actual totals of 8, 11, 12 on a 7.5 line.

### [OU-B] Environmental Override *(PRIMARY)*

**Wind OUT tiers (v3.0 split — confirmed at 113 games):**
- Wind blowing **OUT 8–15 mph** → **Lean OVER** (57% hit rate — weaker signal; cancelled if temp < 60°F; subject to Wind-Ace Interaction Rule §3.9). Do not bet OVER on 8–15mph alone without a secondary signal.
- Wind blowing **OUT > 15 mph + temp > 60°F** → **Strong OVER** (78% hit rate — primary signal; cancelled if temp < 60°F; downgraded to Lean OVER if temp 60–64°F; subject to Wind-Ace Interaction Rule §3.9). This is the strongest single OVER signal in the system.

**Wind IN tiers (v3.0 updated):**
- Wind blowing **IN > 10 mph + temp < 60°F** → **Strong UNDER** (71% hit rate — cold suppressive wind combo)
- Wind blowing **IN > 8 mph** (any temp) → **Lean UNDER** *(valid regardless of pitcher quality)*

> **Wind-Ace Interaction (v2.6):** Before triggering OU-B for wind OUT, check pitcher xFIP. Both SPs xFIP > 3.50 → fires normally. Either SP xFIP ≤ 3.25 → downgrade to OU-D input only. Both SPs xFIP ≤ 3.25 → cancel OU-B entirely. Wind IN is never cancelled by pitcher quality.

> **Wrigley Field Wind Direction Confirmation (v3.2):** At Wrigley Field (CHC home), wind readings are notoriously inconsistent due to the stadium's open design — wind direction can reverse between the flag reading and game time. **Before issuing any O/U bet based on wind at Wrigley**, require explicit real-time wind direction confirmation (not a forecast). If direction is unconfirmed or reported as "variable", downgrade any wind-based OU-B signal to OU-D input only (do not fire as a primary trigger). Flag: `"WRIGLEY_UNCONF: wind direction unconfirmed — OU-B downgraded to OU-D"`

> **Coors Field OVER Gate (v3.2):** At Coors Field (COL home), only activate an OVER lean when **both teams have avg_runs ≥ 3.5** over their last 10 games. When either team averages < 3.5, the Coors inflation effect is insufficient to overcome the run suppression from a cold/ineffective offence — OVER hit rate with either team < 3.5 avg = **52% (no edge)**. This gate prevents reflexive Coors OVER bets. Flag if blocked: `"COORS_OVER_GATE failed — [team] avg_runs <3.5, insufficient offence for Coors OVER"`

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
- GVI > 75 (no ace veto) → **Strong OVER** (67% hit rate — requires no ace xFIP ≤ 3.25 veto)
- GVI 65–75 → **Lean OVER** (61% hit rate)
- GVI < 35 → **Strong UNDER** (69% hit rate)
- **GVI 35–65 → Dead Zone — Pass O/U** (51% hit rate, no edge). Do NOT place an O/U bet based on GVI alone when it falls in this range. Only override with a primary signal: P10 ≤ 6.5, RCF+Slumping (65%), or Wind OUT > 15mph (78%). Empirical: 113-game dataset confirms GVI 35–65 produces no meaningful directional edge. *(capped at Moderate confidence in April per §3.6)*

### [OU-F] April O/U Default Rule (v3.1 — replaces UNDER default)
**Prior rule (UNDER default) reversed.** 128-game dataset: April OVER = **59.4% (19/32)**; April UNDER = **39.6% (19/48)**. The original UNDER default (from a 20-game sample) is now empirically inverted at scale.

**Trigger:** Game date April 1–30 AND no OU-A, OU-B, or OU-C signal fired.
→ **Default: PASS** — do not force a directional bet unless a signal from OU-A through OU-D exists.
→ The prior "default to UNDER" no longer applies. No primary signal = no O/U bet in April.

**High-Line Lean (v3.2):** See §3.6 — lines **9.0–9.4** lean OVER (Low confidence). Lines **≥9.5 → PASS** (OVER banned at 36%). Do not apply any OVER lean at ≥9.5 even in the absence of a primary signal.

**Low-Line UNDER Ban — 7.5–7.9 (v3.1 — NEW):** When O/U line is **7.5–7.9** AND model direction is UNDER in April → **PASS (banned)**. Hit rate: 3/11 = **27.3%**, avg actual total = **10.3 runs**. The market price of 7.5–7.9 already reflects suppression; UNDER has zero additional edge and loses badly. This supersedes the prior Low-confidence cap.

**Low-Line UNDER Floor (retained from v2.5, narrowed):** When O/U line **≤ 7.4** AND model predicts UNDER in April → cap confidence at **Low**. Lines ≤7.4 = 60% Under hit rate when projected total ≤ 6.5; proceed with Low confidence only (subject to all 7 gates).

**Low-Line UNDER Confidence Cap (retained from v2.4):** When O/U line **8.0–8.4** AND model predicts UNDER in April → cap confidence at **Moderate**. Empirical: 5/14 = 35.7% UNDER hit rate on 8.0–8.4 lines — still weak; do not go above Moderate.

**O/U Confidence assignment:**
- **High:** 3+ suppression signals stack AND not in April (April hard-cap applies) — OR 2+ OVER signals clearly align outside April
- **Moderate:** 1 strong override signal or 2 conflicting drivers resolved by GVI; maximum tier in April
- **Low:** GVI tiebreaker only, unresolved conflict, or high-line UNDER default in April

**Over % conversion table:**

| Confidence | OVER % | UNDER % | Display format |
|-----------|--------|---------|---------------|
| High | 72% | 28% | `OVER (High — 72%)` / `UNDER (High — 28%)` |
| Moderate | 61% | 39% | `OVER (Moderate — 61%)` / `UNDER (Moderate — 39%)` |
| Low | 54% | 46% | `OVER (Low — 54%)` / `UNDER (Low — 46%)` |

> **Always display confidence level AND percentage together.** Every O/U output must read `DIRECTION (Confidence — X%)` — never confidence alone or percentage alone. This applies to the §8.1 output, export string, and JSON `ou_confidence` display.

---

## 6. Confidence Scoring & Variance Flags

Start at **100 points**. Minimum score: **25**. **April maximum score: 70** — any calculated confidence above 70 in April 1–30 is capped at 70. Empirical: the two highest-confidence April games (85, 65+) both produced wrong ML picks; inflated confidence in small-sample-size season leads to over-betting.

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
| Significant Weather Risk | SWR | −10 | Precipitation probability ≥ 85% (skip) or 65–84% (halve stake) — v2.8 revised from 40% |
| April OVER Pick | AOP (v3.1 REMOVED) | ~~−10~~ | **RULE REMOVED** — April OVER is now 59.4% (19/32). The prior 40% claim was from an early 20-game sample. OVER is the winning April direction; no deduction applied. |
| Knowledge-Heavy April | KHA (v2.3) | −15 | April game AND 3+ pitcher stats filled from knowledge base (2024 data used, not 2025 confirmed) |
| April Home Pick | AHP (v2.4) | −8 | Home team predicted as winner in April — empirical: home picks correct only 42% of the time in April |
| Knowledge xFIP Primary | KXF (v2.5) | −10 | UNDER call primarily driven by knowledge-estimated xFIP — confirmed xFIP not available for the key suppressor pitcher |
| Hot Batting Team Hard Skip | HBTF (v2.7) | −25 | Either team avg_runs ≥ 5.0 AND on a 3+ game win streak — P7_SKIP active; 14% hit rate historically |
| Road Ace Ban | RAF (v2.7) | −30 | Away SP xFIP ≤ 3.25 pitching on the road — P4_VETO active; no edge (50% hit rate, -2.7% ROI) |
| High Confidence Cap | HCB (v2.7) | −20 | Confidence score ≥ 65 — P9_BAN active; capped to 64 for betting (25% hit rate at 65+ historically) |
| Venue Cold UNDER Ban | VCB (v2.7) | −30 | Target Field or Progressive Field + temp < 55°F + UNDER direction — P8_BAN active; permanently banned |
| Under Environmental Block | ENV_BLOCK (v2.8) | −20 | Previous day's MLB slate avg total **≥ 10.0** runs (inclusive) — Gate A failed; Under bets suspended |
| Under Estimate Too High | EST_HIGH (v2.8) | −15 | Corrected projected total (raw + bias) > 6.5 — Gate E failed; Under bet not eligible |
| Home Offensive Surge | HOS (v3.0) | −30 | Home team avg_runs ≥ 6.0 over last 3 games — Gate 0 failed; Under veto (0% hit rate, 113-game data) |
| Both RED Unavailable | BRU (v3.0) | −20 | Both SPs < 3 confirmed starts — O/U 38%, pass all O/U; exception: P10 ≤ 6.5 |
| Dual High-Variance Pitchers | DHVP (v3.0) | −15 | Both SPs PVS > 15 — O/U 41%, skip unless primary signal (P10/RCF+Slump/Wind OUT >15) present |
| Warm Weather Under Veto | WARM_VETO (v3.2) | −20 | Temp ≥ 85°F AND UNDER direction AND GVI ≥ 25 — Under hit rate 31% at ≥85°F without GVI <25 |
| Cold Hammer Override | COLD_HAMMER (v3.2) | Override | Temp < 50°F + wind ≥ 15 mph → Strong UNDER hard override (81%). Not a deduction — fires as pre-OU-A override. Still subject to all 7 Under gates. |
| BSS Line Cap | BSS_LINE (v3.2) | −20 | BSS OVER signal fires but line > 9.0 — market has priced in volatility; BSS edge disappears (41% at >9.0 lines) |
| Both xFIP Blind | BOTH_XFIP_BLIND (v3.2) | −25 | Both SPs estimated xFIP + <3 confirmed starts — no O/U direction output at all (38% accuracy) |
| Wrigley Wind Unconfirmed | WRIGLEY_UNCONF (v3.2) | −15 | Wrigley Field game + wind-based OU-B signal + direction unconfirmed — downgrade to OU-D input |
| High-Line April OVER Ban | HLOB (v3.2) | −30 | April game + O/U line ≥ 9.5 + OVER direction — OVER banned at ≥9.5 April lines (36% hit rate) |
| RED Thin Sample | RED_THIN (v3.2) | −5 | SP has 3–5 confirmed starts — RED blended at 0.5 weight; directional signal retained but reliability reduced |

> **Note:** HSGV replaces the postseason-only EGV from v1.0. It applies to high-pressure situations in both regular season and postseason.
> **Note (v2.7):** HBTF and RAF deductions do not reduce confidence — they trigger hard bans (P7_SKIP issues a warning; P4_VETO, P8_BAN, P6_BAN suppress the bet entirely). Deduction values shown above apply only when the flag fires but no hard ban is in effect (e.g., P7_SKIP in non-bet context).

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
5. **O/U Prediction** — displayed as `DIRECTION (Confidence — X%)` e.g. `UNDER (Moderate — 39%)` or `OVER (Low — 54%)`
6. **Confidence Score** — final score out of 100, all deductions itemized
7. **Key Driver Narrative** — 2–3 sentences plain English
8. **Betting Strategy** — tier (Pattern A / Pattern B / Pattern C / Standard / Pass) with O/U and ML recommendations; Combo Bet note when applicable
9. **Export String**
10. **Betting Decision Flags** *(v2.9 — mandatory)* — Output 12 flags covering ML and Under eligibility. Every flag must be evaluated and shown. Format:

```
BETTING DECISION FLAGS (v3.0)
════════════════════════════════════════════════════════════
── ML BET ──────────────────────────────────────────────────
FLAG 1  CONF_ZONE:    [50–64 ✓ ELIGIBLE / <50 ✗ / ≥65 ✗]  → ML bet $75 / Pass
── PRE-GATE CHECKS ─────────────────────────────────────────
FLAG 2  BOTH_RED:     [CLEAR ✓ / BLOCKED ✗ both SPs <3 starts → O/U 38%]  → O/U eligible / pass
FLAG 3  DUAL_PVS:     [CLEAR ✓ / SKIP ⚠️ both PVS >15 → O/U 41%]  → O/U eligible / skip unless signal
── UNDER GATES (0 + A–E must pass; F halves stake) ─────────
FLAG 4  GATE_0:       [CLEAR ✓ home avg_runs <6.0 last 3G / VETO ✗ ≥6.0 → 0% Under]  → Home surge check
FLAG 5  GATE_A:       [CLEAR ✓ / BLOCKED ✗ prev-day avg ≥10.0]  → Under eligible / blocked
FLAG 6  GATE_B:       [CLEAR ✓ / BLOCKED ✗ [team] ≥5 in win]  → Under eligible / reduced
FLAG 7  GATE_C:       [PASS ✓ / FAIL ✗ W-ACE✗ — ERA [x] / [n] starts + [IP] IP]  → SP gate pass/fail (4+ starts + ≥20 IP)
FLAG 8  GATE_D:       [PASS ✓ (ATH/WAS) / FAIL ✗ ([visitor]) / N/A May+]  → April filter
FLAG 9  GATE_E:       [PASS ✓ est [x]+3.0=[y] ≤6.5 / FAIL ✗ est [y] >6.5]  → Estimate gate
FLAG 10 GATE_F:       [N/A (no ESDU) / HALVE ⚠️ ESDU active → half stake]  → Stake reducer
── MODIFIERS ───────────────────────────────────────────────
FLAG 11 APRIL_BIAS:   [temp-sensitive bias applied: +1.5/<50°F / +2.5/50-64°F / +3.0/65-74°F / +3.5/≥75°F / +4.0/≥85°F or Apr1-14 / +2.0 May+]  → Bias correction
FLAG 12 RAIN_GATE:    [clear ✓ <65% / halve stake ⚠️ 65–84% / skip ✗ ≥85%]  → Stake adj
FLAG 13 VENUE_BAN:    [ACTIVE ✗ Target/Progressive cold / NYY April / clear ✓]  → Under ban/clear
FLAG 14 CONF_CAP:     [P9_BAN ✗ conf≥65 capped / clear ✓ / P4_VETO ✗ road ace]  → Cap/ban
FLAG 15 FTMF_MATCH:   [ACTIVE ✓ FORTRESS+TMF → Under confidence escalated / inactive]  → Combo confirm
════════════════════════════════════════════════════════════
ML BET:    [Bet $75 — conf [x] in zone ✓ / Pass — conf outside 50–64 / Pass — conf ≥65]
COMBO BET: [+$25 available — ML and Under align ✓ / N/A — directions differ]
UNDER BET: [All gates pass → Bet $[size] [pattern tier] UNDER [line] / Pass — Gate [X] failed: [reason]]
FINAL RECOMMENDATION: [Combined ML + Under + Combo summary, or Pass with reason]
```

> **Purpose:** Betting Decision Flags give the user a transparent checklist of every empirically-derived gate. The user makes the final call — the model shows exactly where edge exists and where it doesn't.

### 8.1b Betting Strategy Thresholds (v3.1)

> **ML BETS (v3.1):** 128-game data: ML conf 50–54 = 57.7%, conf 55–59 = 60.0%, conf 65–69 = **66.7% (strongest zone)**. Conf 60–64 = 16.7% (weak, small 6-game sample). Bet ML at **$75/bet** when confidence 50–59 OR 65–69. Caution on 60–64 (small sample). Do NOT bet ML at conf < 50 or ≥ 70 (HL trap zone, 25% on 4 games). **P9_BAN applies to O/U only — ML at 65–69 is eligible.**

> **NULL/FLOOR GAMES NOTE (v3.1):** Games with null confidence score or conf=25 (floor) must NOT generate active O/U bet recommendations. These are structural passes — do not output an O/U bet, only output the directional prediction for tracking with a "(NO BET — pass tier)" note. 25 null-confidence games had 10.3% O/U hit rate and are polluting overall accuracy stats.

> **Combo Bet (v2.9):** When both the ML pick AND the Under direction point to the same team winning in a low-scoring game (e.g., LAD home with Ohtani = UNDER + LAD ML), add **+$25–30 as a same-direction combo** on top of standard sizing. Requires: Under passes all 7 gates AND Under direction = ML predicted winner. This is optional but validated by the LAD ace pattern.

**Dual Strategy Tiers (v3.0):**

| Condition | Bet Type | Size | Action |
|-----------|----------|------|--------|
| P4_VETO or P8_BAN active | **Pass** | — | No bet — hard ban |
| BOTH_RED_UNAVAIL or DUAL_PVS_SKIP active (no primary signal) | **Pass (O/U)** | — | O/U pass; ML still eligible |
| P7_SKIP active | **⚠️ Hard Skip** | — | Output warning, no auto-bet |
| Confidence 50–64 | **ML Bet** | **$75** | Bet the model's win probability pick |
| ML + Under align same direction | **Combo add-on** | +**$25–30** | Add on top of ML bet when Under passes all gates |
| P1_MATCH (Dome + dual elite SP) AND all 7 Under gates pass AND conf 50–64 | **Pattern A Under** | $150 unit | UNDER |
| P2_MATCH (home ace vs ATH/WAS) AND all 7 Under gates pass AND conf 50–64 | **Pattern B Under** | $75 unit | UNDER |
| P11_LAD_ACE (LAD home Ohtani/Yamamoto/Sasaki, Gate C met) AND all 7 Under gates pass AND conf 50–64 | **Pattern C Under** | **$100 unit** | UNDER |
| P10_MATCH (corrected projected total ≤ 6.5) AND all 7 Under gates pass AND conf 50–64 | **Strong UNDER** | $50 unit | UNDER — hard cap $50 (mechanical not structural) |
| All 7 Under gates pass AND conf 50–64 only, no pattern match | **Standard Under** | $50 unit | UNDER per model |
| Confidence < 50 OR confidence ≥ 65 (P9_BAN) | **Pass** | — | Outside target zone — no O/U bet |
| Corrected projected total gap < 2.0 runs vs line (§3.9) | **Pass** | — | Insufficient edge |
| Any Under gate 0 or A–E fails | **Pass (Under)** | — | ML still eligible if conf 50–64 |

> **Confidence zone (v2.7):** The ONLY valid O/U betting zone is confidence score 50–64. Below 50 = too uncertain. Confidence ≥ 65 = historically counter-productive (25% hit rate). P9_BAN always caps at 64 for betting purposes. The model may still show a higher calculated confidence for informational tracking — the bet is still capped.

**O/U Bet Gate (v3.2 updated):**
- Calculate `Projected Total` per §3.9
- If `|Projected Total − O/U Line| < 2.0 runs` → O/U bet = **Pass (insufficient gap)**, regardless of confidence tier
- **Exception:** When P10_MATCH is active (corrected total ≤ 6.5), gap threshold = **≥ 1.5 runs** (see §3.9 P10 Gap Exception)
- If gap ≥ 2.0 runs (or ≥ 1.5 for P10) AND DH G2 flag active AND direction = UNDER → **Pass** (DH G2 never bet UNDER)
- Otherwise: apply pattern-based tier above

**Slate Discipline Cap (v3.2 updated):**
> **Maximum 5 bets per daily slate.** When analyzing multiple games in a single day, rank all eligible bets by confidence score. Select the top 5 only. A sixth bet on the same slate requires the user to explicitly override this cap. (Prior cap was 2 — raised to 5 based on 144-game data showing expanded profitable bet frequency.)

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
  "betting_flags": {
    "flag1_conf_zone": "ELIGIBLE — conf 58 in 50–64",
    "flag2_gate_a_environmental": "CLEAR — prev-day avg 8.2 ≤10",
    "flag3_gate_b_momentum": "BLOCKED — [Team] scored 6 in win 1 day ago",
    "flag4_gate_c_sp_quality": "PASS — ERA 2.31, 8 starts",
    "flag5_gate_d_april_visitor": "FAIL — visitor is PHI, not ATH/WAS",
    "flag6_gate_e_estimate": "FAIL — corrected est 7.8 > 6.5",
    "flag7_gate_f_esdu": "N/A — ESDU not active",
    "flag8_april_bias": "+3.0 applied (April)",
    "flag9_rain_gate": "clear — 22% precip",
    "flag10_venue_ban": "clear",
    "flag11_conf_cap": "clear — conf 58 below 65",
    "flag12_ftmf_match": "INACTIVE — no Fortress+TMF combo",
    "ml_bet": "Bet $75 — conf in zone",
    "combo_bet": "N/A — Under failed gates",
    "under_bet": "Pass — Gate B failed (visitor momentum) + Gate D failed (not ATH/WAS)"
  },
  "ml_recommendation": "ML $75 — conf 58 in zone (57.4% historical hit rate, 104-game data) OR Pass — conf outside 50–64",
  "betting_recommendation": "Pattern B Under: UNDER 7.5 $75 (Moderate confidence, all 6 gates pass) + ML $75",
  "export_string": "Away @ Home,Home SP (HOME),Away SP (AWAY),52%,48%,7.5,61% (Over)"
}
```

> **Critical:** Return only valid JSON. No markdown fences, no preamble. Use `"Data Notice: [field] not found"` for unavailable fields. The `ml_recommendation` field must output either `"ML $75 — conf [x] in zone"` or `"Pass — conf outside 50–64"` — never output a banned/suppressed message (P6_BAN was lifted in v2.8).

---

## 9. Changelog

| Version | Changes |
|---------|---------|
| v1.0 | Initial framework — postseason only |
| v2.0 | Defined TMS/GVI formulas; fixed Over%; confidence floor=25; connected RCF; fixed §5A veto logic; wind direction spec; renamed overrides WP/OU prefix; defined HFCF/TMF thresholds; dual-override priority; PDCF fallback; connected all dead inputs |
| v2.1 | **Expanded to Regular Season + Postseason.** Season Type field added to Match ID. PMS split into Regular Season vs Postseason bonus tables. Added regular season flags: Division Race, Wild Card Race, Late Season, Must-Win, Series Momentum. GVI +5 high-stakes bonus. EGV replaced by HSGV (covers both seasons). §8 JSON schema adds season_type field. Export string examples for both seasons. |
| v2.2 | **Accuracy revision from 10-game empirical analysis (ML 30%, 7 structural flaws identified).** (1) Minimum Starts Gate on RED — prevents knowledge-fill from creating false Surging/Slumping flags when pitcher has <3 real starts. (2) §3.8 Early Season Calibration Flag (April 1–14): reduced home base +1%, raised Home Fortress threshold .700, GVI −5/−10 for high lines, TMS 50% weight for <5-game teams. (3) Away Momentum Amplifier: away team TMS lead of 5+ points awards extra +2% on top of Driver 1. (4) TMF win probability effect: now reduces favored team's win probability (−3% away TMF / −5% home TMF) in addition to confidence deduction. (5) OU-A Condition 3 — Both Slumping rule: both pitchers RED > +1.5 → Lean OVER + WP equalization −8%. (6) High-GVI/High-Line Dampener: GVI > 75 AND line > 8.0 caps OU-E at Moderate confidence. (7) Three new confidence deductions: VMF (−10), ESDU (−10), BSS (−10). |
| v2.3 | **Accuracy revision from 20-game empirical results (ML 40%, OVER 40%, UNDER 70%, away teams won 55%). 7 structural fixes.** (1) April OVER Confidence Cap: all OVER predictions in April capped at Moderate regardless of GVI/wind — empirical OVER accuracy was 40%. (2) Wind-Cold Interaction: wind OUT bonus cancelled when temp <60°F — cold air kills ball carry, all 4 wind-OVER misses were in cold weather. (3) §3.8 expanded to two tiers — April 1–14 removes home field bonus entirely (0%), April 15–30 keeps +1%; both apply OVER cap and wind-cold gate. (4) TMS early season soft cap extended from <5 games to <10 games — 3–5 game streaks are random variance in April. (5) OU-F April UNDER Default: when no OU-B/C fires in April, default to UNDER (empirical: UNDER 70% vs OVER 40%). (6) Two new confidence deductions: AOP −10 (April OVER pick), KHA −15 (April game + 3+ knowledge-estimated pitcher stats). (7) GVI gets additional −5 in April when OVER signal is active. |
| v2.4 | **Accuracy revision from 26-game empirical results (ML 46%, OVER 46%, UNDER 62%, away teams won 58%). 7 structural fixes.** (1) April Away Baseline: Tier A sets 48/52 (home/away) baseline with −2% home penalty; Tier B sets 49/51 — prior neutral 0% was not correcting enough for empirical 58% away win rate. (2) Home TMS Dampener: in April, home TMS advantage capped at +1% (not +4%) — home TMS-favored teams won only 38% empirically vs 50% for away TMS-favored. (3) TMS ultra-early tiered cap: <5 games = 0% weight, 5–9 games = 25%, ≥10 games = 100% — first 2–4 game streaks are pure noise. (4) April O/U Confidence Hard Cap: ALL O/U capped at Moderate in April (both OVER and UNDER) — High O/U in April was 46% correct vs Moderate at 62%, inverting the accuracy hierarchy. (5) High-Line April UNDER Default: O/U line ≥9.0 + temp <68°F in April → UNDER (Low) regardless of wind or GVI — OVER on 9.0+ lines in April was 43% correct. (6) Single-Ace UNDER April Cap: single-ace UNDER in April capped at Moderate; High requires 3+ stacked suppression signals — 3 of 4 single-ace High UNDER calls failed (actuals: 8, 11, 12 on 7.5 lines). (7) New AHP confidence deduction: −8 when home team predicted winner in April — empirical home pick accuracy was 42%; April confidence ceiling set at 70. |
| v2.6 | **Post-slate structural tweaks (2026-04-06).** (1) O/U Bet Gap Minimum: only recommend O/U bet when |Projected Total − line| ≥ 2.0 runs — 1.2–1.9 run gaps are only 0.25–0.4 SD and statistically invisible in single-game samples. (2) Doubleheader G2 Flag: DH G2 always leans OVER, never recommend UNDER — tired bullpens give up more runs, not fewer; +8 GVI for DH G2. (3) Wind-Ace Interaction: wind OUT cancelled as OVER signal when either SP xFIP ≤ 3.25; both aces cancel entirely — empirical: TOR@CWS 17mph wind OUT, total = 3 runs. (4) ML threshold raised to 65%: implied probability must exceed 65% for a meaningful single-game edge; prior 62% threshold was too low. (5) Slate Discipline Cap: maximum 2 bets per daily slate — skip discipline is working, over-betting marginal picks is the problem. |
| v2.7 | **Pattern policy overhaul from 56-game empirical dataset (2026-04-10). ML 22–34 (39%), O/U 27–28 (49%), Modified O/U 58.5%.** (1) ML bets PERMANENTLY BANNED — 34 tracked ML bets hit at 39%, -13.7% ROI; P6_BAN always active; betting_recommendation and JSON ml_recommendation now suppress moneyline entirely. (2) High confidence cap (P9_BAN) — bets with confidence ≥ 65 historically hit at 25%, -27.7%; cap effective betting confidence at 64 max. (3) §3.10 Pattern Betting Policies added — 10 empirically-derived patterns (P1–P10) with MATCH/VETO/SKIP/BAN flags, pattern tier sizing (A=$150, B=$75, Standard), and Pattern Match Report output. (4) O/U target zone set to confidence 50–64 exclusively — 42 games at 58.5% hit rate; outside this zone = Pass. (5) P7_SKIP (Hot Batting Team) — 14% hit rate, hard skip warning. (6) P8_BAN (Venue Cold UNDER) — Target Field/Progressive Field cold UNDER permanently banned, 20% hit rate. (7) P4_VETO (Road Ace vs Home Offence) — 50% hit rate, -2.7% ROI, banned from bet recommendations. (8) P10_MATCH — projected total ≤ 6.5 + UNDER was 100% correct across 27 games; strong signal added. (9) Pattern Match Report mandatory in every analysis output. (10) §8.1b overhauled to pattern-based O/U tier system replacing ML tiers. |
| v2.8 | **Dual-strategy overhaul from 77-game empirical dataset (2026-04-14). ML 43–34 (55.8%), Moderate conf ML 60% (40 games), last 5 ML = 80%. O/U 31–43 (41.9%), last 10 O/U = 10%.** (1) **ML BETS REINSTATED** — P6_BAN lifted; ML 55.8% overall with moderate conf at 60%; $75/bet at 50–64 confidence; do not bet ML outside this zone. (2) **April bias correction +3.0** (was +2.0) added to all projected totals in April — slate averages 11–14 runs vs model baseline of 8–9; Under losses avg 12.1 runs = systematic underestimation. (3) **Under 5-Gate System** — all 5 gates must pass: Gate A (prev-day avg ≤10), Gate B (both teams no ≥5-run win last 2 days), Gate C (home SP sub-2.50 ERA + 6+ verified starts), Gate D (April: visiting team ATH/WAS only), Gate E (corrected est ≤ 6.5). Any gate failure = skip Under. (4) **P2 narrowed** — valid only when visiting team is ATH or WAS in April (~67% hit rate). All other visitors in April = skip Under. (5) **P3 suspended** — 33% hit rate vs originally claimed 60%; suspended until May retest. (6) **Rain policy revised** — skip at ≥85% (was 40%), halve stake at 65–84%. (7) **10 Betting Decision Flags** replace Pattern Match Report in all outputs — FL1 CONF_ZONE through FL10 CONF_CAP, covering both ML and Under eligibility. (8) ENV_BLOCK and EST_HIGH confidence deductions added. (9) Bimodal Under distribution confirmed: wins avg 5.2 runs, losses avg 12.1 — no middle ground; corrected est ≤5.5 for high conviction. (10) Low conf O/U (< 50) = 29% hit rate = never bet O/U below 50. |
| v2.5 | **Accuracy revision from 32-game empirical results (ML 47%, OVER 50%, UNDER 50%, away teams won 53%). 6 structural fixes.** (1) Mandatory April O/U Gate: explicit gate forces Moderate cap AFTER direction is set — rule existed in v2.4 but was never enforced, all 16 April predictions violated it; High O/U was 47.1% vs Moderate 61.5%. (2) xFIP Estimation Gate: knowledge-estimated xFIP cannot drive High O/U confidence — cap at Moderate; combined estimation cap (2+ estimated key inputs) also forces Moderate; empirical: all 5 UNDER High misses had estimated xFIP as primary GVI suppressor. (3) Home Bonus Accumulation Cap: in April, total home bonuses from §4 Step 3 capped at +8% above baseline — model was picking HOME 68.8% vs 46.9% actual home wins due to stacked bonuses. (4) No-Edge Pass Threshold: final win probability 47–53% → ML betting recommendation = Pass; close games went 1-for-8 (12.5%). (5) Low-Line UNDER Floor: O/U line ≤7.5 in April → UNDER capped at Low confidence; every UNDER on a 7.5 April line missed high (actuals: 8, 8, 12, 16). (6) OU-F empirical recalibration: 32-game dataset shows 50/50 OVER/UNDER actual split with lines running +0.52 below actuals — UNDER default retained as precautionary lean but confidence defaulted to Low (not Moderate); new KXF deduction −10 when UNDER driven by estimated xFIP. |
| v2.9 | **104-game empirical refinements (2026-04-16). ML moderate-conf 57.4% across 54 games. 6 validated rules incorporated.** (1) **FORTRESS+TMF Combo Flag (FTMF)** — new §3.7 flag: Home Fortress + away TMF = 73% Under hit rate (6/8 games); escalates Under confidence to Moderate if currently Low. (2) **ML stats updated** — 57.4% at 54 moderate-conf games (was 60% at 40 games); Combo Bet added (+$25–30 when ML and Under align same direction). (3) **Gate C W-ACE✗ hard stop confirmed** — 0% Under hit rate in 4 games when Gate C fails; explicit warning added to Gate C and Flag 4. (4) **P8_BAN re-confirmed** — 22% Under at Target/Progressive Field cold; permanent ban reaffirmed from 104-game data. (5) **Gate F (ESDU Stake Reducer)** added — ESDU active in April correlates with 65% Over rate; halve stake rather than skip. Under 5-gate system becomes **6-gate system**. (6) **P11_LAD_ACE Pattern C** added — LAD home Ohtani/Yamamoto/Sasaki with Gate C met = 80% Under hit rate (4/5 games); $100 unit; highest-conviction Under signal in system; Ohtani qualifies ~May 4–6. (7) Betting Decision Flags expanded from 10 to **12 flags** (Gate F + FTMF_MATCH added). (8) Tier table updated with Pattern C ($100) and Combo Bet row. (9) JSON schema updated with new flag fields. |
| v3.0 | **113-game empirical refinements (2026-04-17). 9 structural updates from deep pattern analysis.** (1) **Gate 0 (Home Offensive Surge Veto)** — home avg_runs ≥ 6.0 last 3 games = veto ALL Under bets; 0% Under hit rate in 4 qualifying cases; added as first Under gate before Gate A. (2) **Gate A threshold fixed** — changed from `> 10` (strictly greater) to `≥ 10.0` (inclusive); Apr 16 borderline case confirmed the edge case. (3) **Both RED_unavailable ban** — both SPs < 3 starts = pass O/U (38% hit rate, 22 games); exception: P10 ≤ 6.5 still valid. (4) **P10 hit rate corrected** — updated from 100%/27 games to 74%/23 games; P10 stake hard-capped at $50. (5) **RCF + Slumping = explicit OVER signal** — when RCF fires + RED > +1.5 on same SP = 65% OVER, 17 games; added to §3.5 as named signal. (6) **GVI dead zone skip** — GVI 35–65 = 51% hit rate = no O/U bet unless primary signal present; OU-E updated with explicit dead zone rule. (7) **Wind OUT tiers split** — >15mph + >60°F = 78% OVER (was ~68%); 8–15mph drops to 57% (weaker, needs secondary signal). Wind IN threshold updated: >10mph + <60°F = 71% Strong UNDER. (8) **Dual PVS > 15 skip** — both SPs PVS > 15 = 41% O/U accuracy; skip unless primary signal. (9) **NYY home April Under ban** — 17% hit rate (1/6 games); added to P8_BAN. Under 6-gate system expanded to **7-gate system**. Betting Decision Flags expanded to **15 flags**. |
| v3.1 | **128-game empirical refinements (2026-04-18). 6 critical inversions corrected.** (1) **High-Line April UNDER Default reversed** — OVER on 9.0+ lines in April = 64.3% (9/14); UNDER = 28.6% (2/7); §3.6 rule changed from "UNDER Low" to "OVER Low" on ≥9.0 April lines. Exception: dual confirmed ace xFIP ≤ 3.00 → Pass. (2) **OU-F April UNDER Default removed** — April OVER base rate = 59.4% vs UNDER 39.6% in 128-game dataset; the UNDER default (from 20-game sample, UNDER 70%) is empirically inverted at scale; §5 OU-F changed to PASS when no OU-A/B/C/D signal fires. (3) **UNDER on 7.5–7.9 lines in April banned** — 3/11 = 27.3% hit rate, avg actual total 10.3 runs; these bets lose 73% of the time. (4) **P9_BAN clarified as O/U-only** — ML at conf 65–69 = 66.7% (10/15 games), strongest ML zone; ML bets at 65–69 eligible at $75; do not bet ML at conf ≥70 (25%, 4 games). (5) **AOP confidence deduction removed** — April OVER now 59.4%; the −10 deduction for OVER predictions in April was penalizing the winning direction. (6) **Null/floor game O/U tracking note** — 25 null-confidence games had 10.3% O/U hit rate and were artificially suppressing overall stats; conf=25 or null → no active O/U bet recommendation, directional output for tracking only. Real bet zone (conf 50–64) = 55.1% O/U (27/49). |
| v3.2 | **144-game empirical refinements (2026-04-18). 12 structural tweaks + 8 new patterns from full audit.** (1) **Temperature-sensitive April bias correction** — replaces flat +3.0: <50°F=+1.5, 50-64°F=+2.5, 65-74°F=+3.0, ≥75°F=+3.5, ≥85°F=+4.0; April 1-14 always +4.0 regardless of temp. (2) **Gate C loosened to 4+ starts + ≥20 IP** — prior 6-start threshold was blocking 11/18 profitable Under bets (61%); 4-start + IP gate restores access while maintaining ERA reliability. (3) **Gate B strengthened to require BOTH ≥5 runs AND ≥2-game win streak** — prior single-condition gate too broad; win streak confirms sustained momentum. (4) **P4_VETO softened** — dual-ace matchups (both SP xFIP ≤3.25 + Gate C) routed to P1/P2 instead of full ban; prior full ban was blocking 78% of profitable dual-ace Unders. (5) **Cold Hammer hard override** — temp <50°F + wind ≥15mph = 81% Under (pre-OU-A hard override). (6) **Under Heat Gate** — temp ≥85°F requires GVI <25 for UNDER (not <35); 31% hit rate at ≥85°F with GVI 25-35. (7) **BSS line cap** — BSS OVER only fires at line ≤8.5; line >9.0 = market priced in (41% hit rate), −20 conf flag. (8) **Coors OVER gate** — both teams must avg ≥3.5 runs for Coors OVER to activate (52% when either team <3.5). (9) **Wrigley wind direction confirmation required** — unconfirmed = downgrade to OU-D input. (10) **April ≥9.5 OVER banned** — 36% hit rate; 9.0–9.4 OVER lean retained. (11) **Slumping home SP + ≥75°F + hitter park = High OVER** even in April (87% hit rate — overrides April High cap). (12) **P10 gap threshold ≥1.5** when P10_MATCH active (was ≥2.0). (13) **Max 5 bets/day cap** (was 2). (14) **RED thin-sample blend** for 3–5 starts: 0.5×RED + 0.5×PVS_direction. (15) **Both xFIP estimated + <3 starts = no O/U direction output**. (16) **Gate A dual-day check** — if either of last 2 days >9.5 avg, halve stake. (17) **7 new confidence deductions added**: WARM_VETO, COLD_HAMMER, BSS_LINE, BOTH_XFIP_BLIND, WRIGLEY_UNCONF, HLOB, RED_THIN. |

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

*MLB Game Predictor — CLAUDE.md v3.2*

---

## 11. Git Push Workflow Policy

### 11.1 Why This Exists
`predictions-export.json` is committed to git and seeds Railway's DB on volume reset.
If committed with stale LOCAL data, any Railway volume reset permanently overwrites
newer Railway predictions. **This happened on 2026-04-06 (loss of ~10 records, Apr 6–9).**

The root cause: `syncExportFile()` writes `predictions-export.json` from the **local** DB after every local save. The local DB is always behind Railway (users add predictions via the web app). Committing that file without first pulling Railway's current state is inherently dangerous.

### 11.2 Mandatory Pre-Commit Sync
**Before every `git add` / `git commit` involving ANY file changes:**

1. Run `npm run sync-railway` (or `node sync-from-railway.js`)
2. Confirm output shows `SUCCESS` and a row count matching Railway's current total
3. Confirm the newest `saved_at` in the output is a recent Railway date (not a stale local date)
4. Only then proceed with staging and committing

> **Never commit `predictions-export.json` from a local `syncExportFile()` write** — that function writes from the local DB which is always behind Railway.

### 11.3 No Push Without User Confirmation
Claude must **NEVER run `git push`** without explicitly telling the user:
- What branch is being pushed
- What commits are included
- That `npm run sync-railway` succeeded, with the row count shown

Then ask: **"Ready to push to Railway? (yes/no)"**
Only push after the user responds with explicit approval.

### 11.4 Pre-Push Checklist (follow in order every time)
- [ ] 1. `npm run sync-railway` → confirm `SUCCESS` + row count
- [ ] 2. `git diff predictions-export.json` → confirm newest rows have recent Railway dates
- [ ] 3. Stage files: `git add <changed code files> predictions-export.json`
- [ ] 4. Show user the commit message and file list
- [ ] 5. Ask user: **"Ready to push? (yes/no)"**
- [ ] 6. Push only after explicit yes

### 11.5 After Railway Deploys
On the very first push after this Section was added, `/api/export-all` did not yet exist on Railway.
The bootstrap was done manually with the paginated endpoint. From now on, `npm run sync-railway`
calls `/api/export-all` directly and is the only sync method needed.

---

## 12. Code Modification Principles

*Adapted from general LLM coding guidelines. Applies to all code changes in this project.*

### 12.1 Think Before Coding
- State assumptions explicitly before implementing. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick one silently.
- If a simpler approach exists, say so and push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask before proceeding.

### 12.2 Simplicity First
- Write the minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

> Ask: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

### 12.3 Surgical Changes
- Touch only what is directly required by the request.
- Do not "improve" adjacent code, comments, or formatting uninvited.
- Do not refactor things that aren't broken.
- Match existing code style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- If your changes create unused imports/variables/functions, remove those. Do not remove pre-existing dead code unless asked.

> Every changed line should trace directly to the user's request.

### 12.4 Goal-Driven Execution
- Transform tasks into verifiable goals before starting:
  - "Add validation" → "Write tests for invalid inputs, then make them pass"
  - "Fix the bug" → "Reproduce it first, then fix it"
- For multi-step tasks, state a brief plan with verification checks:
  ```
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
  3. [Step] → verify: [check]
  ```
- Don't begin implementation on weak criteria like "make it work" — clarify first.
