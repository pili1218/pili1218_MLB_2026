# MLB Game Predictor Skill

Run a complete MLB Game Predictor deep analysis using the framework defined in CLAUDE.md v2.8.
Applies to **Regular Season and Postseason** games.

## How to invoke

```
/mlb-predict
/mlb-predict <game info or JSON>
/mlb-predict regular season — Yankees vs Red Sox, June 15
/mlb-predict postseason — Game 3 ALCS, Dodgers @ Yankees
```

---

## Execution Instructions

When this skill is invoked, follow these steps in order:

### Step 1 — Locate Game Data & Fill All Missing Fields

Check for available game data in this priority order:

1. **If `$ARGUMENTS` contains game data** (JSON, team names, or description) → parse and use it
2. **If a prior `/api/analyze` extraction was discussed in this session** → use that extracted JSON
3. **If neither is available** → ask the user for at minimum: teams, date, and starting pitchers

**After obtaining game data — apply the three-tier missing data policy before proceeding:**

#### Tier 1 — Use provided source data
Take every field directly from the JSON or user input. Always prefer explicit values.

#### Tier 2 — Deep knowledge search (perform for every null/empty/zero field)
Do not skip any field without first searching your MLB knowledge base:

| Missing Field | Action |
|--------------|--------|
| Pitcher ERA/WHIP/xFIP | Recall current season stats for the named pitcher |
| Pitcher recent starts | Reconstruct last 3–5 starts from known performance trends |
| Team record / streak | Recall current season W-L, home/road splits, last 10 |
| Team batting / avg runs | Recall team offensive profile |
| Bullpen ERA/WHIP/xFIP | Recall team bullpen metrics for current season |
| wRC+ / DRS / OAA | Estimate from known offensive/defensive team profile |
| Weather | Recall typical conditions for the stadium + date range |
| Lineup | Recall typical starting lineup and batting order |
| Betting line | Estimate from pitcher quality and team records |
| Standings / games back | Recall division standings for the current season |

#### Tier 3 — Data Notice (last resort only)
Only issue `Data Notice: [field] not found` if both Tier 1 and Tier 2 fail.

**Track sources throughout:**
```
Extracted from image: [fields]
Filled from knowledge: [fields]
Estimated: [fields]
Data Notice: [fields — if any]
```

**Identify season type** from the data or arguments. Default to Regular Season if ambiguous.

---

### Step 2 — Activate Season-Appropriate Flags

#### If Regular Season:
Check and flag:
- **Division Race Flag:** Is the team within 3 games of their division lead? (+30 PMS)
- **Wild Card Race Flag:** Is the team within 3 games of a wild card spot? (+20 PMS)
- **Must-Win Flag:** Team on 5+ loss streak while in a race? (+15 PMS)
- **Late Season Flag:** Is the game in September? (+10 PMS)
- **Series Momentum Flag:** Team won last 2+ games of this current series? (+10 PMS)
- **Divisional Rivalry:** Are these division rivals? (+15 PMS)

#### If Postseason:
Check and flag:
- **Elimination Game Flag:** Does a loss end the season? (+50 PMS)
- **Series Clinch Flag:** Can they win the series with a win? (+25 PMS)
- **Series Momentum Flag:** Won 2+ consecutive games in this series? (+15 PMS)
- **Divisional Rivalry:** Division rivals? (+15 PMS)

> Both season types: apply only the higher bonus when two race flags would overlap. PMS win% shift = ΔPMS/50, capped ±4%.

---

### Step 3 — Apply the Full Framework (CLAUDE.md v2.8)

Work through every section in order.

#### §3 — Calculate All Metrics

State every value explicitly in a table before proceeding.

**PVS (Home & Away):**
`Game Score = 50 + (IP×3) + (K×2) − (ER×10) − (BB×2) − (H×1)`
Std dev across last 5 starts. Flag PVS > 15.

**RED (Home & Away):**
Avg ERA last 3 starts minus season ERA. Flag Surging (RED < −1.0) or Slumping (RED > +1.5).
> **v2.2 Minimum Starts Gate:** If pitcher has <3 confirmed regular-season starts this season, set RED = 0 and mark `RED_unavailable`. WP-Override A cannot fire. Flag "Early-Season RED Unreliable".

**TMS (Home & Away):**
`G1 + G2 + G3 + G4 + (G5×2)` where Win=+3, Loss=−2, G5=most recent.
Apply −2 travel fatigue penalty if applicable. Range: −14 to +18.
> **v2.3 Extended Early-Season TMS Cap:** If team has played fewer than **10** regular-season games, apply TMS at 50% weight in Driver 1. (Extended from <5 games in v2.2.)

**PMS (Home & Away):**
Base 100 + season-appropriate bonuses (see Step 2). Calculate ΔPMS → win% shift.

**RCF:** xFIP > ERA by ≥1.20 → substitute xFIP for ERA in §4. Flag "Regression Risk".

**Early Season Calibration Flag (v2.5):**
- **Tier A (April 1–14):** Home base = **−2%** (48/52 baseline, away-favored). Home Fortress threshold .700. GVI −5. If line > 8.0, additional GVI −5. TMS weight: 0% if team <5 games, 25% if 5–9 games. Home TMS Dampener: home TMS advantage = +1% only (not +4%). O/U confidence hard cap: **Moderate** (Mandatory April O/U Gate applies — see §5). xFIP Estimation Gate: estimated xFIP cannot drive High confidence. Home Bonus Cap: total home bonuses capped at +8% above 48% baseline. High-line UNDER: O/U ≥9.0 + temp <68°F → UNDER Low. Wind-Cold gate active. No-Edge Pass: 47–53% → Pass.
- **Tier B (April 15–30):** Home base = **−1%** (49/51 baseline). TMS weight: 0% if <5 games, 25% if 5–9. Home TMS Dampener: +1% cap. O/U confidence hard cap: Moderate. xFIP Estimation Gate active. Home Bonus Cap: total home bonuses capped at +8% above 49% baseline. High-line UNDER rule active. Wind-Cold gate active. No-Edge Pass: 47–53% → Pass.

**Doubleheader G2 Flag (v2.6):** Check if this game is DH G2. If yes: add +8 to GVI, set `dh_g2 = true`, apply OVER lean in §5, never recommend UNDER bet. Flag: "DH G2 — OVER lean applied".

**Projected Total (v2.6):** Compute `(home avg_runs + away avg_runs) × park_factor_multiplier`. Apply bullpen adjustment: +0.5 if either bullpen ERA > 4.50; −0.3 if either bullpen ERA < 3.50. Record as `projected_total`. O/U bet recommendation requires |projected_total − ou_line| ≥ 2.0. If gap < 2.0 → O/U bet = Pass (insufficient gap).

**§3.9 April Bias Correction (v2.8):** After computing Projected Total + bullpen adjustment, add **+3.0 runs (April)** or +2.0 runs (May+). Apply BEFORE the ≥2.0 gap gate check. Empirical: April games average 11–14 runs/game; Under losses avg 12.1 runs — systematic underestimation was root cause of 10% O/U in last 10 games.

**§3.9 Under 5-Gate System (v2.8):** ALL 5 gates must pass before recommending any Under bet:
- **Gate A:** Prev-day MLB slate avg total ≤ 10 runs/game (else skip all Unders)
- **Gate B:** BOTH home AND visiting team: no ≥5-run win in the last 2 days (else skip or reduce)
- **Gate C:** Home SP sub-2.50 ERA (2026) with **6+ verified starts** (ERA labels before 6 starts unreliable)
- **Gate D (April only):** Visiting team must be **ATH or WAS** — all other visitors → skip Under in April
- **Gate E:** Corrected projected total (raw + 3.0) ≤ **6.5** (else skip)

**§3.9 Rain Policy (v2.8):** ≥85% precip → skip; 65–84% → halve stake; <65% → normal.

**§3.10 Pattern/Betting Checks (v2.8):** Evaluate ALL checks below. Record in `betting_flags`. Evaluate in order: P8_BAN → P4_VETO → GATE_A → GATE_B → GATE_C → GATE_D → GATE_E → P9_BAN → P1/P2 → CONF_ZONE.

| Check | Trigger | Policy |
|-------|---------|--------|
| P1_dome_dual_ace | Indoor/dome stadium + both SPs ERA<2.50 + 6+ starts | Pattern A UNDER (~67%) — all 5 gates still required |
| P2_home_ace_vs_weak | Home SP ERA<2.50+6+ starts + visiting team **ATH or WAS** (April) | Pattern B UNDER (~67%) |
| P3_cold_natural_grass | Temp<45°F + natural grass + no wind OUT | **SUSPENDED** (33% hit rate) — informational only |
| P4_road_ace_veto | Away SP xFIP≤3.25 on road | **BAN all bets this game** (50% = no edge) |
| CONF_ZONE | Final confidence 50–64 | Valid zone for both ML and Under bets |
| P6_ML_MOD | Confidence 50–64 | **ML bet $75 REINSTATED** (60% moderate conf, 77 games) |
| P7_hot_batting_skip | Either team avg_runs≥5.0 + 3+ win streak | **Hard skip warning** — 14% hit rate |
| P8_venue_cold_under_ban | Target Field/Progressive Field + temp<55°F + UNDER | **BAN** (20% hit rate) |
| P9_high_confidence_cap | Confidence ≥65 | Cap at 64; Pass for betting (25% hit rate) |
| P10_projected_total_lte65 | Corrected projected total ≤6.5 + UNDER | Strong UNDER signal (100% verified, 27 games) |

**GVI:** Start 50, apply all table adjustments from §3.6 including:
- +5 if postseason OR both teams in active race (high-stakes game bonus)
- −5 if Early Season Calibration active (Tier A or B)
- −5 additional if Early Season AND line > 8.0 (Tier A only)
- **April OVER Suppression (v2.3):** If game is in April AND an OVER signal is active → additional −5 GVI
- Cap 1–100. Flag GVI>65 (OVER bias), GVI<35 (UNDER bias).
- **High-GVI/High-Line Dampener:** GVI > 75 AND line > 8.0 → cap OU-E confidence at Moderate.
- **xFIP Estimation Gate (v2.5):** If pitcher xFIP is knowledge-estimated (not confirmed current-season), that xFIP cannot drive High O/U confidence — cap at Moderate. Tag as `xFIP_estimated`. If 2+ key inputs estimated → Combined Estimation Cap forces Moderate regardless of GVI.

**Wind-Cold Interaction Rule (v2.3):**
If wind is blowing OUT AND temperature < 60°F → cancel the wind OVER bonus entirely (cold air kills carry).
If temperature 60–64°F → downgrade Strong OVER to Lean OVER.

Issue Data Notices for any unavailable fields and continue.

---

#### §4 — Win Probability Synthesis

1. Collect all modifiers: H2H (+3%), defense (−2% per elite team to opponent), PMS shift (±4%)
2. **WP-Override A** (priority over B): Surging ace (xFIP<3.25, RED<−1.0, and NOT `RED_unavailable`) vs Slumping pitcher (RED>+1.5, and NOT `RED_unavailable`) → +14%
3. **WP-Override B**: Home Fortress (home win% ≥ .650, or ≥ .700 if Early Season flag active) vs road team (road win%<.500) → +10%
4. If no dominant override — baseline 50/50 + home field:
   - **April 1–14 (Tier A):** **−2% to home team** (48/52 away-favored baseline) — empirical: away teams won 58%
   - **April 15–30 (Tier B):** **−1% to home team** (49/51 away-favored baseline)
   - **May onward:** +2% home field
   Then:
   - Driver 1 (Momentum): higher TMS +4%, subject to tiered early-season cap (0% if <5 games, 25% if 5–9 games) AND **Home TMS Dampener (v2.4)**: in April, if HOME team has higher TMS → +1% only (not +4%)
   - **Away Momentum Amplifier (v2.2):** If away team TMS leads by 5+ points AND no WP-Override active → away gets additional +2% (total +6% away TMS benefit before home offsets)
   - Driver 2 (Venue): Home Fortress +5%
5. **Both SP Slumping check (v2.2):** If both pitchers RED > +1.5 → subtract 8% from favored team's win probability before normalization.
6. **TMF win probability adjustment (v2.2):** If TMF active for away team → −3% home win probability. If TMF active for home team → −5% home win probability.
7. **PDCF check**: road team higher TMS AND home team Home Fortress:
   - Bullpen xFIP diff > 0.40 → +4%
   - Platoon wRC+ diff > 15 → +3%
   - RISP wRC+ advantage → +2%
   - All tied: 52% home / 48% away
8. Add PMS shift + H2H + defense modifiers
9. **Home Bonus Accumulation Cap (v2.5):** In April 1–30, sum all bonuses added to home team above the April baseline (48% Tier A / 49% Tier B). If total > +8%, trim excess starting from least-impactful bonus (Defense → H2H → PMS → Fortress). WP-Override A is exempt.
10. Normalize to 100. Cap 80/20. Check HFCF (≥68%) and MCF (vs betting favorite).
11. **No-Edge Pass Threshold (v2.5):** If final home win probability is **47–53%**, set `ml_edge = "no-edge"`. Betting recommendation for ML = **Pass**. O/U continues normally.

---

#### §5 — Over/Under Synthesis

> **⚠️ MANDATORY APRIL O/U GATE (v2.5):** First, check the game date. If April 1–30, record `april_ou_gate = ACTIVE`. Run OU-A through OU-E to determine **direction** (OVER/UNDER). Then, **before writing the confidence**, apply the gate: force confidence to Moderate. Exception: UNDER may reach High only if 3+ suppression factors stack with **confirmed** data (ace xFIP <3.00 from current-season logs + pitcher's park + temp <55°F + GVI <30). This override is FINAL — apply it after all other OU logic, immediately before output. Do not skip.

Evaluate in strict order, stop at first trigger:

**OU-A:**
- Condition 1: Surging vs Slumping → Lean OVER (Strong if slumping team 15-day wRC+>108)
- Condition 2: Both Surging → Strong UNDER. April cap: Moderate max. Veto: wind OUT>15mph AND temp≥60°F nullifies UNDER; reinforces OVER to High confidence.
- **Condition 3 (v2.2): Both Slumping (both RED > +1.5)** → Lean OVER. Escalate to Strong if either team 15-day wRC+>108. Also apply WP equalization −8% to favored team.
- **Single-Ace UNDER April Cap (v2.4):** In April, single-ace-based UNDER → cap at Moderate. High UNDER requires 3+ suppression factors (ace xFIP<3.00 + pitcher's park + temp<55°F or dual aces).

**OU-B:** 
- Wind OUT >8mph → OVER — **CANCELLED if temp <60°F (v2.3 Wind-Cold Interaction Rule)**
- Wind IN >8mph → UNDER *(not affected by pitcher quality)*
- Wind OUT >15mph → Strong OVER — **downgraded to Lean OVER if temp 60–64°F; cancelled if temp <60°F**
> **Wind-Ace Interaction (v2.6):** Before firing any wind OUT signal — check xFIP tags. Both SPs xFIP > 3.50 → OU-B fires normally. Either SP xFIP ≤ 3.25 → downgrade to OU-D input only (not primary trigger). Both SPs xFIP ≤ 3.25 → cancel OU-B entirely, fall to OU-D. Wind IN never vetoed. Flag "Wind-Ace Veto active".

**OU-C:** Both teams 15-day wRC+ > 115 → OVER.

**OU-D:** Balance: Ace Suppressor (xFIP<3.25) vs Red Hot Offense (wRC+>110, avg_runs>5.0). Park factor and temp<50°F.

**OU-E:** GVI>65 → OVER. GVI<35 → UNDER. GVI 35–65 → lean nearest driver or market direction.
> **High-GVI/High-Line Dampener (v2.2):** If GVI>75 AND line>8.0, cap confidence at **Moderate**.
> **April OVER Confidence Cap (v2.3):** In April, any OVER call is capped at Moderate confidence unless temp ≥68°F AND hitter's park.

**OU-F — April UNDER Default Rule (v2.3, enhanced v2.5):**
> If game is in April AND neither OU-B nor OU-C has fired → **default to UNDER** (Low confidence).
> **High-Line Extension (v2.4):** If O/U line ≥ 9.0 AND temp < 68°F in April → force UNDER (Low) **even if OU-B fired**. High-line OVER in April = 43%.
> **Low-Line UNDER Cap (v2.4):** If O/U line ≤ 8.0 AND predicting UNDER in April → cap at Moderate confidence.
> **Low-Line UNDER Floor (v2.5):** If O/U line ≤ 7.5 AND predicting UNDER in April → cap at **Low** confidence. Every UNDER on a 7.5 April line missed high (actuals: 8, 8, 12, 16). Market fully prices suppression at this line; no added edge.
> Exception: override to OVER if temp ≥68°F AND hitter's park AND avg_runs > 5.0.
> **Empirical note (v2.5):** 32-game dataset shows 50/50 OVER/UNDER actual with lines running +0.52 below actuals. UNDER default retained as precautionary lean — use Low confidence on the default, not Moderate.

Assign confidence (High/Moderate/Low). Apply conversion table:
| Confidence | OVER% | UNDER% |
|-----------|-------|--------|
| High | 72% | 28% |
| Moderate | 61% | 39% |
| Low | 54% | 46% |

---

#### §6 — Confidence Score

Start 100. Floor = 25.

| Flag | Deduction | Trigger |
|------|-----------|---------|
| PDCF | −30 | Road TMS-favored + home Fortress |
| MCF | −25 | Contradicts betting favorite |
| HFCF | −20 | Either team ≥68% |
| TMF | −20 | Either team 5+ loss streak |
| HVIF | −15 | GVI > 75 |
| HSGV | −15 | Elimination game OR both teams within 1 game of cutoff |
| KHA (v2.3) | −15 | April game AND 3+ pitcher stat fields filled from knowledge/estimate |
| VMF (v2.2) | −10 | GVI > 70 AND final win probability 55–65% |
| ESDU (v2.2) | −10 | Early Season flag active AND 2+ fields knowledge-estimated |
| BSS (v2.2) | −10 | Both pitchers RED > +1.5 |
| AOP (v2.3) | −10 | OVER pick made in April (early-season OVER unreliable) |
| SWR | −10 | Precipitation > 40% |
| AHP (v2.4) | −8 | Home team predicted as winner in April — empirical: home picks correct only 42% in April |
| KXF (v2.5) | −10 | UNDER call primarily driven by knowledge-estimated xFIP — confirmed current-season xFIP not available for the key suppressor pitcher |
| HBTF (v2.7) | −25 | P7_SKIP active — either team avg_runs≥5.0 AND on 3+ win streak (14% hit rate) |
| RAF (v2.7) | −30 | P4_VETO active — away SP xFIP≤3.25 pitching on road (50% hit rate, no edge) |
| HCB (v2.7) | −20 | P9_BAN active — confidence score ≥65; cap at 64 for betting (25% hit rate at 65+) |
| VCB (v2.7) | −30 | P8_BAN active — Target Field/Progressive Field + temp<55°F + UNDER direction (20% hit rate) |

**April confidence ceiling (v2.4):** After all deductions, cap final score at **70** if game date is April 1–30.

---

### Step 4 — Generate Full Output

**1. Season Context Block**
State: Regular Season or Postseason. List all active season-specific flags.

**2. Flags & Scores Table**
Every metric with value and triggered flags.

**3. Override Status**
Which WP and OU overrides fired or were skipped, with reasoning.

**4. Win Probability**
```
[Home Team]: XX%   [Away Team]: XX%
```

**5. O/U Prediction**
```
Prediction: OVER/UNDER [line]   Confidence: High/Moderate/Low   Over%: XX%
```

**6. Confidence Score**
```
Score: XX/100   Deductions: [itemized list]
```

**7. Key Driver Narrative**
2–3 sentences. Lead with the most important factor. Reference season type where relevant.

**8. Betting Strategy (v2.8 — Dual ML + Under)**

**ML bets REINSTATED (v2.8):** If confidence 50–64 → output ML bet $75. Outside zone → no ML bet.

Apply gates and bans in order:

| Condition | ML | Under |
|-----------|-----|-------|
| P4_VETO active (road ace) | `Pass — road ace ban` | `Pass — road ace ban` |
| P8_BAN active (venue cold) | n/a | `Pass — venue cold UNDER ban` |
| P7_SKIP active (hot batting team) | `⚠️ Hard Skip warning` | `⚠️ Hard Skip warning` |
| Conf < 50 or ≥ 65 | `Pass — outside 50–64 zone` | `Pass — outside 50–64 zone` |
| Any Under gate fails | eligible if conf in zone | `Pass — Gate [X] failed` |
| Gap < 2.0 runs (corrected) | n/a | `Pass — insufficient gap` |
| DH G2 + UNDER | n/a | `Pass — DH G2 never Under` |
| Conf 50–64 | `ML bet $75` | evaluate Under gates |
| All gates pass + P1_MATCH | `ML bet $75` | `Pattern A Under $150` |
| All gates pass + P2_MATCH (ATH/WAS) | `ML bet $75` | `Pattern B Under $75` |
| All gates pass + P10_MATCH (est ≤6.5) | `ML bet $75` | `Strong Under $75` |
| All gates pass, no pattern | `ML bet $75` | `Standard Under $50` |

**Slate Discipline Cap (v2.6):** Max 2 Under bets per daily slate. ML bets: no cap if moderate conf.

**9. Export String**
```
Away @ Home,Home SP (HOME),Away SP (AWAY),Home Win%,Away Win%,O/U Line,Over% (Over/Under)
```

**10. Betting Decision Flags (v2.8 — mandatory)**
Output the following 10-flag report showing ML eligibility, all 5 Under gates, and modifiers:
```
BETTING DECISION FLAGS (v2.8)
════════════════════════════════════════════════════════════
── ML BET ──────────────────────────────────────────────────
FLAG 1  CONF_ZONE:    [50–64 ✓ ELIGIBLE / <50 ✗ / ≥65 ✗]  → ML bet $75 / Pass
── UNDER GATES (all 5 must pass) ───────────────────────────
FLAG 2  GATE_A:       [CLEAR ✓ prev-day avg X.X / BLOCKED ✗ avg >10]  → Under eligible / blocked
FLAG 3  GATE_B:       [CLEAR ✓ / BLOCKED ✗ [team] scored X in win N days ago]  → eligible / skip
FLAG 4  GATE_C:       [PASS ✓ ERA X.XX / N starts / FAIL ✗ ERA X.XX or N<6 starts]  → SP gate
FLAG 5  GATE_D:       [PASS ✓ visitor=ATH/WAS / FAIL ✗ visitor=[team] / N/A (May+)]  → April filter
FLAG 6  GATE_E:       [PASS ✓ raw X.X+3.0=Y.Y≤6.5 / FAIL ✗ corrected Y.Y>6.5]  → Estimate gate
── MODIFIERS ───────────────────────────────────────────────
FLAG 7  APRIL_BIAS:   [+3.0 applied (April) / +2.0 applied (May+)]  → Corrected est: X.X
FLAG 8  RAIN_GATE:    [clear ✓ X% / halve stake ⚠️ X% (65–84%) / skip ✗ X% ≥85%]  → stake
FLAG 9  VENUE_BAN:    [ACTIVE ✗ — [venue] cold UNDER banned / clear ✓]  → ban/clear
FLAG 10 CONF_CAP:     [P9_BAN ✗ conf≥65 → Pass / clear ✓ conf<65 / P4_VETO ✗ road ace]
════════════════════════════════════════════════════════════
ML BET:    [Bet $75 — conf [X] ✓ / Pass — conf [X] outside 50–64 / Pass — conf ≥65 (25% hit rate)]
UNDER BET: [All gates ✓ → [tier]: [OVER/UNDER] [line] $[size] / Pass — Gate [N] ✗ [reason]]
FINAL RECOMMENDATION: [ML $75 + Under $XX / ML only $75 / Under only $XX / Pass — all bets blocked]
```

**11. JSON Output**
Full §8.3 JSON schema including `season_type`, `pattern_matches`, and `ml_recommendation` fields.

---

## Notes

- **Never halt the analysis due to missing data** — always attempt Tier 2 knowledge search first
- Always identify season type first — it determines which PMS bonuses and flags apply
- In regular season, standings context is as important as pitcher matchup
- Win probabilities must sum to 100, cap 80/20
- Confidence floor is 25
- Over % comes from the conversion table only
- Track data sources (image / knowledge / estimated) for every filled field
- A Data Notice is a last resort, not a default — only use when knowledge search also fails
- **April rules (v2.5):** Wind-Cold gate, Mandatory April O/U Gate (force Moderate after direction set), xFIP Estimation Gate, Home Bonus Accumulation Cap (+8% max), No-Edge Pass (47–53%), Low-Line UNDER Floor (≤7.5 → Low), OU-F UNDER default (Low confidence), AOP/KHA/AHP/KXF deductions — all apply when game date is in April
- **TMS cap applies to teams with <10 games played** (tiered: 0% if <5 games, 25% if 5–9 games, 100% if ≥10)
- **xFIP Estimation Gate:** Always tag pitcher xFIP as `confirmed` or `estimated` before setting O/U confidence — estimated xFIP cannot produce High confidence
- **v2.6 rules — always apply:** (1) Compute `projected_total` before any O/U bet rec; gap < 2.0 runs = Pass. (2) Check for DH G2 — never bet UNDER in DH G2. (3) Wind-Ace Interaction — check xFIP before firing OU-B wind OUT. (4) Slate cap = 2 bets max per day when analyzing multiple games. (5) MLB total SD ≈ 4.5 runs — a 1.2-run model edge is only 0.27 SD; calibrate confidence accordingly.
- **v2.8 rules — always apply:** (1) **ML REINSTATED** at $75 for moderate confidence 50–64 (60% historical hit rate). Outside 50–64 = no ML bet. (2) **April bias +3.0** added to all projected totals before gate check (not +2.0). (3) **Under 5-gate system** — ALL gates A–E must pass; any failure = skip Under. (4) **Gate D April filter**: visiting team must be ATH or WAS in April — all other visitors = skip Under. (5) **P3 SUSPENDED** (33% hit rate). (6) **Rain policy**: ≥85% skip, 65–84% halve stake. (7) Output mandatory **Betting Decision Flags** (#10) in every analysis — all 10 flags shown. (8) Low conf (<50) O/U = 29% hit rate — never bet O/U below 50. (9) P4_VETO, P7_SKIP, P8_BAN, P9_BAN, P10_MATCH from v2.7 all remain active. (10) ML bet is a separate track from Under — if Under gate fails, ML may still be eligible if conf in zone.
