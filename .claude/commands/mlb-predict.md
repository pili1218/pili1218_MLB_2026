# MLB Game Predictor Skill — v3.5

Invoke a complete MLB prediction using the **full framework defined in CLAUDE.md v3.5**.
Do NOT replicate framework rules here — CLAUDE.md is the single source of truth.
Applies to **Regular Season and Postseason**.

## How to invoke

```
/mlb-predict
/mlb-predict <game info or JSON>
/mlb-predict regular season — Yankees vs Red Sox, June 15
/mlb-predict postseason — Game 3 ALCS, Dodgers @ Yankees
```

---

## Step 1 — Obtain Game Data

Check in this priority order:

1. **`$ARGUMENTS` contains game data** (JSON, team names, date) → parse and use it
2. **Prior `/api/analyze` extraction in this session** → use that extracted JSON
3. **Neither available** → ask the user for: teams, date, starting pitchers (minimum)

Apply the **three-tier missing data policy from CLAUDE.md §7** before proceeding.
Identify season type (Regular Season / Postseason). Default to Regular Season if ambiguous.

---

## Step 2 — Run the Full Framework

Follow **CLAUDE.md sections 1–8 in strict order**. Do not skip steps.

Key execution reminders (these do NOT replace CLAUDE.md — refer there for full rules):

- **§3**: Compute PVS, RED, TMS, PMS, RCF, GVI for both teams. Apply all v3.5 gates and flags.
- **§4**: Win probability synthesis — WP-Override A > B, Driver 1/2, PDCF tiebreakers, AWAY_ACE_OVERRIDE (R14).
- **§5**: O/U synthesis — Cold Hammer → OU-A → OU-B → OU-C → OU-D → OU-E → OU-F. Apply Master Inversion Warning check before finalising.
- **§3.11**: Evaluate ALL rules R1–R14 before issuing any bet recommendation.
- **§3.10**: Evaluate ALL 26 patterns P1–P26. Output the 15 Betting Decision Flags.
- **§6**: Confidence scoring (floor 25, April ceiling 70).

**v3.5 critical rules to enforce (most commonly missed):**
- R1: No O/U signal + no Slumping/Surging flags = PASS with no direction (not OVER Low)
- R5 REVERSED: PVS>15 = confidence suppressor only (−10/pitcher). Do NOT route OVER on PVS.
- R8: MCF = full ML prohibition (50% coin flip). Not a 25% reduction.
- R12: Conf 55–65 = O/U dead zone (extended). Output PASS — no direction.
- GVI<35 + UNDER = pre-gate hard ban (7/7 = 100% failure, avg 13.7 runs).
- R14 AWAY_ACE_OVERRIDE: Away SP RED<−1.0 → −10% home WP, flip ML to away.
- SINGLE_RED_UNAV: RED missing on either SP (not just both) → O/U PASS.
- OU-F: No signal = PASS with no direction. The 59.4% April OVER stat is NOT a default trigger.
- Gate C: 4+ verified 2026 starts AND ≥20 IP (not 6 starts).
- WP-Override B: +5% only (downgraded from +10%). Weak secondary signal — never primary driver.

---

## Step 3 — Generate Full Output (CLAUDE.md §8)

Output all required sections in order:

1. Season Context + active flags
2. Flags & Scores table (all §3 metrics)
3. Override Status
4. Win Probability (home% / away%, sums to 100, cap 80/20)
5. O/U Prediction (`DIRECTION (Confidence — X%)` format)
6. Confidence Score (itemised deductions)
7. Key Driver Narrative (2–3 sentences)
8. Betting Strategy (tier + ML + O/U recommendations + Combo Bet note)
9. Export String
10. **Betting Decision Flags** (all 15 flags — mandatory)
11. JSON Output (full §8.3 schema)

---

## Hard Rules (apply every time)

- Never halt due to missing data — run Tier 2 knowledge search first (CLAUDE.md §7)
- Win probabilities must sum to 100, cap 80/20
- Confidence floor = 25, April ceiling = 70
- Track data sources: extracted / knowledge / estimated for every field
- Slate discipline cap: max 5 bets per daily slate
- Always output `DIRECTION (Confidence — X%)` format for O/U — never confidence alone
