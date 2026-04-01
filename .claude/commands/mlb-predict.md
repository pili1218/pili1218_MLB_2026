# MLB Game Predictor Skill

Run a complete MLB Game Predictor deep analysis using the framework defined in CLAUDE.md v2.3.
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

### Step 3 — Apply the Full Framework (CLAUDE.md v2.3)

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

**Early Season Calibration Flag (v2.3):**
- **Tier A (April 1–14):** Home base = 0% (not +2%, not +1%). Home Fortress threshold .700. GVI −5. If line > 8.0, additional GVI −5. TMS 50% weight if team <10 games. Wind-Cold gate active. OVER cap active.
- **Tier B (April 15–30):** Home base = +1%. TMS 50% weight if team <10 games. Wind-Cold gate active. OVER cap active.

**GVI:** Start 50, apply all table adjustments from §3.6 including:
- +5 if postseason OR both teams in active race (high-stakes game bonus)
- −5 if Early Season Calibration active (Tier A or B)
- −5 additional if Early Season AND line > 8.0 (Tier A only)
- **April OVER Suppression (v2.3):** If game is in April AND an OVER signal is active → additional −5 GVI
- Cap 1–100. Flag GVI>65 (OVER bias), GVI<35 (UNDER bias).
- **High-GVI/High-Line Dampener:** GVI > 75 AND line > 8.0 → cap OU-E confidence at Moderate.
- **April OVER Confidence Cap (v2.3):** In April, cap any OVER confidence at Moderate — unless temp ≥68°F AND hitter's park.

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
   - **April 1–14 (Tier A):** +0% home field
   - **April 15–30 (Tier B):** +1% home field
   - **May onward:** +2% home field
   Then:
   - Driver 1 (Momentum): higher TMS +4% (halved to +2% with Momentum Dampener Veto if facing xFIP<3.00 ace; at 50% weight if team <10 games played)
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
9. Normalize to 100. Cap 80/20. Check HFCF (≥68%) and MCF (vs betting favorite).

---

#### §5 — Over/Under Synthesis

Evaluate in strict order, stop at first trigger:

**OU-A:**
- Condition 1: Surging vs Slumping → Lean OVER (Strong if slumping team 15-day wRC+>108)
- Condition 2: Both Surging → Strong UNDER. Veto: wind OUT>15mph AND temp≥60°F nullifies UNDER; reinforces OVER to High confidence.
- **Condition 3 (v2.2): Both Slumping (both RED > +1.5)** → Lean OVER. Escalate to Strong if either team 15-day wRC+>108. Also apply WP equalization −8% to favored team.

**OU-B:** 
- Wind OUT >8mph → OVER — **CANCELLED if temp <60°F (v2.3 Wind-Cold Interaction Rule)**
- Wind IN >8mph → UNDER
- Wind OUT >15mph → Strong OVER — **downgraded to Lean OVER if temp 60–64°F; cancelled if temp <60°F**

**OU-C:** Both teams 15-day wRC+ > 115 → OVER.

**OU-D:** Balance: Ace Suppressor (xFIP<3.25) vs Red Hot Offense (wRC+>110, avg_runs>5.0). Park factor and temp<50°F.

**OU-E:** GVI>65 → OVER. GVI<35 → UNDER. GVI 35–65 → lean nearest driver or market direction.
> **High-GVI/High-Line Dampener (v2.2):** If GVI>75 AND line>8.0, cap confidence at **Moderate**.
> **April OVER Confidence Cap (v2.3):** In April, any OVER call is capped at Moderate confidence unless temp ≥68°F AND hitter's park.

**OU-F — April UNDER Default Rule (v2.3):**
> If game is in April AND neither OU-B nor OU-C has fired → **default to UNDER** (Low confidence).
> Exception: override to OVER if temp ≥68°F AND hitter's park AND avg_runs > 5.0.
> Rationale: April offense is cold, pitchers are fresh, sample sizes are unreliable — lean UNDER when no strong environmental or offensive signal fires.

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

**8. Betting Strategy**
```
Tier: Strong / Moderate / Slight / Pass
Moneyline: [team] ML
Totals: [OVER/UNDER] [line] ([confidence])
```

Thresholds:
- win%≥62% AND conf≥65 → Strong
- win% 56–62% AND conf≥58 → Moderate
- win% 52–56% AND conf≥50 → Slight
- else → Pass

**9. Export String**
```
Away @ Home,Home SP (HOME),Away SP (AWAY),Home Win%,Away Win%,O/U Line,Over% (Over/Under)
```

**10. JSON Output**
Full §8.3 JSON schema including `season_type` field.

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
- **April rules (v2.3):** Wind-Cold gate, April OVER cap, OU-F UNDER default, AOP/KHA deductions — all apply when game date is in April
- **TMS cap applies to teams with <10 games played** (extended from <5 in v2.2)
