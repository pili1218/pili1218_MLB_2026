// ─── State ────────────────────────────────────────────────────────────────────
let currentPage = 1;
let totalPages  = 1;
let activePredId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadHistory();
  // Auto-refresh banner every 30 seconds
  setInterval(loadStats, 30000);
});

// ─── Stats Dashboard ──────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch("/api/stats");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    document.getElementById("stTotal").textContent  = json.total;
    document.getElementById("stGraded").textContent = json.graded;
    document.getElementById("stML").textContent     = json.ml_accuracy != null ? json.ml_accuracy + "%" : "—";
    document.getElementById("stOU").textContent     = json.ou_accuracy != null ? json.ou_accuracy + "%" : "—";
    document.getElementById("stMLW").textContent    = json.graded ? `${json.ml_wins} / ${json.ml_losses}` : "—";
    document.getElementById("stOUW").textContent    = json.ou_graded ? `${json.ou_wins} / ${json.ou_losses}` : "—";

    // Color ML accuracy
    const mlEl = document.getElementById("stML");
    if (json.ml_accuracy != null) {
      mlEl.style.color = json.ml_accuracy >= 58 ? "var(--green)" : json.ml_accuracy >= 50 ? "var(--gold)" : "var(--red)";
    }
    const ouEl = document.getElementById("stOU");
    if (json.ou_accuracy != null) {
      ouEl.style.color = json.ou_accuracy >= 55 ? "var(--green)" : json.ou_accuracy >= 48 ? "var(--gold)" : "var(--red)";
    }

    // Season type breakdown
    if (json.by_season_type && json.by_season_type.length > 0) {
      const el = document.getElementById("seasonBreakdown");
      el.classList.remove("hidden");
      el.innerHTML = json.by_season_type.map(s => {
        const mlAcc = s.total > 0 ? (s.ml_wins / s.total * 100).toFixed(1) : null;
        const ouAcc = s.ou_graded > 0 ? (s.ou_wins / s.ou_graded * 100).toFixed(1) : null;
        return `
          <div class="season-chip">
            <span class="season-label">${esc(s.season_type || "Unknown")}</span>
            <span class="season-stat">ML ${mlAcc != null ? mlAcc + "%" : "—"}</span>
            <span class="season-stat">O/U ${ouAcc != null ? ouAcc + "%" : "—"}</span>
            <span class="season-stat dim">${s.total} games</span>
          </div>`;
      }).join("");
    }

    // Investigation panel
    if (json.graded > 0) {
      document.getElementById("investigationPanel").classList.remove("hidden");
      renderRunningAccuracy(json);
      renderTierTable(json.by_tier || []);
    }

    // Daily summary + strategy
    const dailyRow = document.getElementById("dailyRow");
    if (json.graded > 0) {
      dailyRow.style.display = "grid";
      renderDailySummary(json);
      renderStrategyBox(json);
    } else {
      dailyRow.style.display = "none";
    }

  } catch (err) {
    console.error("Stats error:", err);
  }
}

function renderRunningAccuracy(json) {
  const winEl = document.getElementById("invWindows");
  const trendEl = document.getElementById("invTrendRow");

  // Window comparison cards
  const windows = [
    { label: "Last 5",  ml: json.last5_ml,  ou: json.last5_ou  },
    { label: "Last 10", ml: json.last10_ml, ou: json.last10_ou },
    { label: "All",     ml: json.ml_accuracy, ou: json.ou_accuracy },
  ];

  winEl.innerHTML = windows.map(w => {
    const mlColor = w.ml == null ? "" : w.ml >= 58 ? "var(--green)" : w.ml >= 50 ? "var(--gold)" : "var(--red)";
    const ouColor = w.ou == null ? "" : w.ou >= 55 ? "var(--green)" : w.ou >= 48 ? "var(--gold)" : "var(--red)";
    return `
      <div class="inv-window-card">
        <div class="inv-win-label">${w.label}</div>
        <div class="inv-win-row">
          <span class="inv-win-metric">ML</span>
          <span class="inv-win-val" style="color:${mlColor}">${w.ml != null ? w.ml + "%" : "—"}</span>
        </div>
        <div class="inv-win-row">
          <span class="inv-win-metric">O/U</span>
          <span class="inv-win-val" style="color:${ouColor}">${w.ou != null ? w.ou + "%" : "—"}</span>
        </div>
      </div>`;
  }).join("");

  // Trend direction
  let trendHtml = "";
  if (json.last5_ml != null && json.last10_ml != null) {
    const mlTrend = json.last5_ml - json.last10_ml;
    const mlArrow = mlTrend > 2 ? "↑" : mlTrend < -2 ? "↓" : "→";
    const mlColor = mlTrend > 2 ? "var(--green)" : mlTrend < -2 ? "var(--red)" : "var(--text2)";
    trendHtml += `<span class="inv-trend-chip" style="color:${mlColor}">ML Trend ${mlArrow} ${mlTrend > 0 ? "+" : ""}${mlTrend.toFixed(1)}%</span>`;
  }
  if (json.last5_ou != null && json.last10_ou != null) {
    const ouTrend = json.last5_ou - json.last10_ou;
    const ouArrow = ouTrend > 2 ? "↑" : ouTrend < -2 ? "↓" : "→";
    const ouColor = ouTrend > 2 ? "var(--green)" : ouTrend < -2 ? "var(--red)" : "var(--text2)";
    trendHtml += `<span class="inv-trend-chip" style="color:${ouColor}">O/U Trend ${ouArrow} ${ouTrend > 0 ? "+" : ""}${ouTrend.toFixed(1)}%</span>`;
  }
  trendEl.innerHTML = trendHtml || `<span style="color:var(--text3);font-size:0.8rem">Not enough data for trend</span>`;
}

function renderTierTable(tiers) {
  const el = document.getElementById("tierTable");
  if (!tiers.length) {
    el.innerHTML = `<span style="color:var(--text3);font-size:0.8rem">No graded predictions yet</span>`;
    return;
  }
  const order = { High: 0, Moderate: 1, Low: 2 };
  tiers.sort((a, b) => (order[a.tier] ?? 9) - (order[b.tier] ?? 9));

  el.innerHTML = `
    <table class="tier-table">
      <thead>
        <tr>
          <th>Confidence Tier</th>
          <th>Games</th>
          <th>ML Accuracy</th>
          <th>O/U Accuracy</th>
          <th>Calibration</th>
        </tr>
      </thead>
      <tbody>
        ${tiers.map(t => {
          const mlAcc = t.total > 0 ? +(t.ml_wins / t.total * 100).toFixed(1) : null;
          const ouAcc = t.ou_graded > 0 ? +(t.ou_wins / t.ou_graded * 100).toFixed(1) : null;
          const mlColor = mlAcc == null ? "" : mlAcc >= 58 ? "var(--green)" : mlAcc >= 50 ? "var(--gold)" : "var(--red)";
          const ouColor = ouAcc == null ? "" : ouAcc >= 55 ? "var(--green)" : ouAcc >= 48 ? "var(--gold)" : "var(--red)";

          // Calibration verdict
          let calib = "—", calibColor = "var(--text3)";
          if (mlAcc != null) {
            if (t.tier === "High" && mlAcc >= 60)        { calib = "Well Calibrated"; calibColor = "var(--green)"; }
            else if (t.tier === "High" && mlAcc < 50)    { calib = "Overconfident";   calibColor = "var(--red)"; }
            else if (t.tier === "Low"  && mlAcc >= 55)   { calib = "Underestimated";  calibColor = "var(--gold)"; }
            else if (t.tier === "Moderate" && mlAcc >= 55){ calib = "Consistent";     calibColor = "var(--green)"; }
            else                                          { calib = "Neutral";         calibColor = "var(--text2)"; }
          }

          return `
            <tr>
              <td><span class="tier-badge tier-badge--${(t.tier||"").toLowerCase()}">${esc(t.tier)}</span></td>
              <td>${t.total}</td>
              <td style="color:${mlColor};font-weight:700">${mlAcc != null ? mlAcc + "%" : "—"}</td>
              <td style="color:${ouColor};font-weight:700">${ouAcc != null ? ouAcc + "%" : "—"}</td>
              <td style="color:${calibColor};font-size:0.8rem;font-weight:600">${calib}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

// ─── Daily Results Summary ────────────────────────────────────────────────────
function renderDailySummary(json) {
  const graded  = json.graded  || 0;
  const total   = json.total   || 0;
  const mlWins  = json.ml_wins  || 0;
  const mlLoss  = json.ml_losses || 0;
  const ouWins  = json.ou_wins  || 0;
  const ouLoss  = json.ou_losses || 0;
  const ouGraded = json.ou_graded || 0;
  const mlAcc   = json.ml_accuracy;
  const ouAcc   = json.ou_accuracy;
  const pending = total - graded;

  document.getElementById("dailySummaryDate").textContent = `${graded} graded · ${pending} pending`;

  const mlColor = mlAcc == null ? "var(--text3)" : mlAcc >= 60 ? "var(--green)" : mlAcc >= 50 ? "var(--gold)" : "var(--red)";
  const ouColor = ouAcc == null ? "var(--text3)" : ouAcc >= 58 ? "var(--green)" : ouAcc >= 48 ? "var(--gold)" : "var(--red)";

  // Summary sentence
  let summary = "";
  if (graded === 0) {
    summary = "No graded results yet. Enter actual scores after games to start tracking accuracy.";
  } else if (mlAcc >= 65) {
    summary = `Strong overall record of ${mlWins}–${mlLoss} on Moneyline (${mlAcc}%). The framework is performing above expectations.`;
  } else if (mlAcc >= 50) {
    summary = `Profitable overall at ${mlWins}–${mlLoss} on Moneyline (${mlAcc}%). Model is above breakeven — continue building the sample.`;
  } else {
    summary = `Current record ${mlWins}–${mlLoss} on Moneyline (${mlAcc}%). Below breakeven — review the confidence tier table for patterns.`;
  }

  // Season type breakdown chips
  const bySeasonHtml = (json.by_season_type || []).map(s => {
    const acc = s.total > 0 ? (s.ml_wins / s.total * 100).toFixed(1) : null;
    const c = acc == null ? "var(--text3)" : acc >= 58 ? "var(--green)" : acc >= 50 ? "var(--gold)" : "var(--red)";
    return `<div class="daily-result-row">
      <span style="color:var(--text2);font-weight:600">${esc(s.season_type || "Unknown")}</span>
      <span style="color:${c};font-weight:700;margin-left:auto">${acc != null ? acc + "% ML" : "—"}</span>
      <span style="color:var(--text3);font-size:0.75rem">${s.total} games</span>
    </div>`;
  }).join("");

  document.getElementById("dailySummaryContent").innerHTML = `
    <div class="daily-record-row">
      <div class="daily-record-pill" style="border-color:${mlColor}">
        <span class="daily-rec-label">ML</span>
        <span class="daily-rec-val" style="color:${mlColor}">${mlWins}–${mlLoss}</span>
        ${mlAcc != null ? `<span class="daily-rec-pct" style="color:${mlColor}">${mlAcc}%</span>` : ""}
      </div>
      ${ouGraded > 0 ? `<div class="daily-record-pill" style="border-color:${ouColor}">
        <span class="daily-rec-label">O/U</span>
        <span class="daily-rec-val" style="color:${ouColor}">${ouWins}–${ouLoss}</span>
        ${ouAcc != null ? `<span class="daily-rec-pct" style="color:${ouColor}">${ouAcc}%</span>` : ""}
      </div>` : ""}
      <div class="daily-record-pill" style="border-color:var(--border)">
        <span class="daily-rec-label">Total</span>
        <span class="daily-rec-val" style="color:var(--text)">${total}</span>
        <span class="daily-rec-pct" style="color:var(--text3)">${graded} graded</span>
      </div>
    </div>
    <p class="daily-summary-text">${summary}</p>
    ${bySeasonHtml ? `<div class="daily-games-list">${bySeasonHtml}</div>` : ""}`;
}

// ─── Betting Strategy Suggestion ─────────────────────────────────────────────
function renderStrategyBox(json) {
  const suggestions = [];
  const warnings = [];

  const mlAcc   = json.ml_accuracy;
  const ouAcc   = json.ou_accuracy;
  const last5ML  = json.last5_ml;
  const last10ML = json.last10_ml;
  const last5OU  = json.last5_ou;
  const last10OU = json.last10_ou;
  const tiers   = json.by_tier || [];

  const highTier = tiers.find(t => t.tier === "High");
  const modTier  = tiers.find(t => t.tier === "Moderate");
  const lowTier  = tiers.find(t => t.tier === "Low");

  const highML = highTier && highTier.total > 0 ? +(highTier.ml_wins / highTier.total * 100).toFixed(1) : null;
  const modML  = modTier  && modTier.total  > 0 ? +(modTier.ml_wins  / modTier.total  * 100).toFixed(1) : null;
  const lowML  = lowTier  && lowTier.total  > 0 ? +(lowTier.ml_wins  / lowTier.total  * 100).toFixed(1) : null;

  // ML trend
  if (last5ML != null && last10ML != null) {
    const drift = last5ML - last10ML;
    if (drift >= 8) {
      suggestions.push({ icon: "↑", color: "var(--green)", text: `ML picks are trending up strongly (+${drift.toFixed(1)}% last 5 vs last 10). Consider increasing unit size on high-conviction plays.` });
    } else if (drift <= -8) {
      warnings.push({ icon: "↓", color: "var(--red)", text: `ML picks are in a cold streak (${drift.toFixed(1)}% last 5 vs last 10). Reduce bet sizes and wait for model to stabilize.` });
    } else {
      suggestions.push({ icon: "→", color: "var(--text2)", text: `ML accuracy is stable (${last5ML}% last 5 games). Continue current approach.` });
    }
  }

  // O/U trend
  if (last5OU != null && last10OU != null) {
    const drift = last5OU - last10OU;
    if (drift >= 8) {
      suggestions.push({ icon: "↑", color: "var(--green)", text: `O/U picks are improving (+${drift.toFixed(1)}% recent trend). The totals model is well-calibrated right now.` });
    } else if (drift <= -8) {
      warnings.push({ icon: "↓", color: "var(--red)", text: `O/U accuracy dropping (${drift.toFixed(1)}% recent trend). Skip totals plays until the model re-calibrates.` });
    }
  }

  // Confidence tier advice
  if (highML != null) {
    if (highML >= 62) {
      suggestions.push({ icon: "★", color: "var(--gold)", text: `High confidence plays are hitting at ${highML}%. Prioritize these — the model is well-calibrated at the top tier.` });
    } else if (highML < 50) {
      warnings.push({ icon: "⚠", color: "var(--red)", text: `High confidence plays are underperforming (${highML}%). Avoid treating these as strong plays — the model may be overconfident early in the season.` });
    }
  }
  if (modML != null && modML >= 58) {
    suggestions.push({ icon: "✓", color: "var(--green)", text: `Moderate confidence plays are hitting ${modML}% — outperforming expectations. These are your most reliable plays right now.` });
  }
  if (lowML != null && lowML >= 58) {
    suggestions.push({ icon: "↑", color: "var(--gold)", text: `Even Low confidence picks are hitting ${lowML}%. The model may be under-rating its own signals — watch these for value.` });
  }

  // Overall ML accuracy
  if (mlAcc != null) {
    if (mlAcc >= 65) {
      suggestions.push({ icon: "🔥", color: "var(--green)", text: `Overall ML accuracy at ${mlAcc}% — well above breakeven. Stay active and trust the framework.` });
    } else if (mlAcc < 45) {
      warnings.push({ icon: "⛔", color: "var(--red)", text: `Overall ML accuracy at ${mlAcc}% — below breakeven. Review recent misses for systematic patterns before placing new bets.` });
    }
  }

  // O/U overall
  if (ouAcc != null && ouAcc < 45) {
    warnings.push({ icon: "⚠", color: "var(--red)", text: `O/U accuracy at ${ouAcc}% overall. Consider skipping totals plays until accuracy improves above 50%.` });
  }

  // Default if no signals
  if (!suggestions.length && !warnings.length) {
    suggestions.push({ icon: "📊", color: "var(--text2)", text: "Keep grading predictions to build a large enough sample for reliable strategy recommendations. Aim for at least 10 graded games." });
  }

  const renderItem = (item) => `
    <div class="strategy-item" style="border-left-color:${item.color}">
      <span class="strategy-icon" style="color:${item.color}">${item.icon}</span>
      <span class="strategy-text">${item.text}</span>
    </div>`;

  document.getElementById("strategyContent").innerHTML =
    warnings.map(renderItem).join("") +
    suggestions.map(renderItem).join("");
}

// ─── History Table ────────────────────────────────────────────────────────────
async function loadHistory(page = 1) {
  currentPage = page;
  const wrap = document.getElementById("histTable");
  wrap.innerHTML = `<div class="hist-loading">Loading…</div>`;

  try {
    const res  = await fetch(`/api/predictions?page=${page}&limit=25`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    totalPages = Math.max(1, Math.ceil(json.total / json.limit));
    renderTable(json.data);
    renderPagination(json.total, json.page, json.limit);
  } catch (err) {
    wrap.innerHTML = `<div class="hist-loading" style="color:var(--red)">${esc(err.message)}</div>`;
  }
}

function renderTable(rows) {
  const wrap = document.getElementById("histTable");
  // Cache rows for safe modal lookup
  _rowCache = {};
  rows.forEach(r => { _rowCache[r.id] = r; });

  if (!rows.length) {
    wrap.innerHTML = `<div class="hist-loading" style="color:var(--text3)">No predictions saved yet. Run a deep analysis and click "Save Prediction".</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="hist-table">
      <colgroup>
        <col class="col-id">
        <col class="col-date">
        <col class="col-matchup">
        <col class="col-type">
        <col class="col-pred">
        <col class="col-ou">
        <col class="col-conf">
        <col class="col-actual">
        <col class="col-ml">
        <col class="col-ouR">
        <col class="col-flags">
        <col class="col-actions">
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>Date</th>
          <th>Matchup</th>
          <th>Type</th>
          <th>Prediction</th>
          <th>O/U</th>
          <th>Conf</th>
          <th>Actual</th>
          <th>ML</th>
          <th>O/U</th>
          <th>Flags</th>
          <th>Rules</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => renderRow(r)).join("")}
      </tbody>
    </table>`;
}

function buildInvestigation(r) {
  if (r.ml_correct === null && r.ou_correct === null) {
    return `<span class="inv-pending">Pending result</span>`;
  }

  const parts = [];

  // 1. Calibration label
  const conf = r.confidence_score || 0;
  const mlOk = r.ml_correct === 1;
  let calib = "", calibColor = "";
  if (conf >= 70 && mlOk)    { calib = "✓ Well Calibrated"; calibColor = "var(--green)"; }
  else if (conf >= 70 && !mlOk){ calib = "⚠ Overconfident";  calibColor = "var(--red)"; }
  else if (conf < 50 && mlOk) { calib = "↑ Underestimated";  calibColor = "var(--gold)"; }
  else if (conf < 50 && !mlOk){ calib = "✓ Expected Miss";   calibColor = "var(--text2)"; }
  else if (mlOk)              { calib = "✓ Correct";          calibColor = "var(--green)"; }
  else                        { calib = "✗ Incorrect";        calibColor = "var(--red)"; }
  parts.push(`<span class="inv-chip" style="color:${calibColor}">${calib}</span>`);

  // 2. Win probability edge
  const predWinPct = Math.max(r.home_win_pct || 0, r.away_win_pct || 0);
  const edge = predWinPct - 50;
  if (edge > 0) {
    const edgeColor = mlOk ? "var(--green)" : "var(--red)";
    parts.push(`<span class="inv-chip inv-chip--sm" style="color:${edgeColor}">Edge ${mlOk ? "+" : "−"}${edge.toFixed(0)}%</span>`);
  }

  // 3. Score vs O/U line
  if (r.actual_home_score != null && r.actual_away_score != null && r.ou_line) {
    const total = r.actual_home_score + r.actual_away_score;
    const line  = parseFloat(r.ou_line);
    if (!isNaN(line)) {
      const gap = total - line;
      const gapStr = (gap >= 0 ? "+" : "") + gap.toFixed(1);
      const lineColor = gap > 0 ? "var(--accent2)" : "var(--blue)";
      parts.push(`<span class="inv-chip inv-chip--sm" style="color:${lineColor}">Total ${total} (${gapStr} vs ${line})</span>`);
    }
  }

  // 4. Prob discrepancy for O/U
  if (r.ou_over_pct != null && r.ou_correct !== null) {
    const ouEdge = Math.abs(r.ou_over_pct - 50);
    const ouOk   = r.ou_correct === 1;
    const ouColor = ouOk ? "var(--green)" : "var(--red)";
    parts.push(`<span class="inv-chip inv-chip--sm" style="color:${ouColor}">O/U Edge ${ouOk ? "+" : "−"}${ouEdge.toFixed(0)}%</span>`);
  }

  return parts.join("");
}

function buildFlags(r) {
  const flags = [];

  // Pull from active_flags — map to short codes only
  const FLAG_MAP = [
    [/PDCF|Primary Driver Conflict/i,     'PDCF'],
    [/MCF|Model Contradiction/i,           'MCF'],
    [/HFCF|Heavy Favorite Caution/i,       'HFCF'],
    [/TMF|Team Meltdown/i,                 'TMF'],
    [/HVIF|High Volatility Index/i,        'HVIF'],
    [/HSGV|High.Stakes Game/i,             'HSGV'],
    [/KHA/i,                               'KHA'],
    [/VMF|Volatile Moderate/i,             'VMF'],
    [/ESDU|Early Season Data/i,            'ESDU'],
    [/BSS|Both SP Slumping/i,              'BSS'],
    [/AOP|April OVER Pick/i,               'AOP'],
    [/SWR|Weather Risk|rain/i,             'SWR'],
    [/AHP|April Home Pick/i,               'AHP'],
    [/KXF/i,                               'KXF'],
    [/HBTF|Hot Batting Team/i,             'HBTF'],
    [/RAF|Road Ace Ban/i,                  'RAF'],
    [/HCB|High Confidence Cap/i,           'HCB'],
    [/VCB|Venue Cold UNDER/i,              'VCB'],
    [/ENV_BLOCK|Environmental Block/i,     'ENV_BLOCK'],
    [/EST_HIGH|Estimate Too High/i,        'EST_HIGH'],
    [/WP.Override A/i,                     'WPOvr-A'],
    [/WP.Override B/i,                     'WPOvr-B'],
    [/Surging.*Home SP|Home SP.*Surging/i, 'SURGE-H'],
    [/Surging.*Away SP|Away SP.*Surging/i, 'SURGE-A'],
    [/Slumping.*Home SP|Home SP.*Slumping/i,'SLUMP-H'],
    [/Slumping.*Away SP|Away SP.*Slumping/i,'SLUMP-A'],
    [/High Volatility.*Home|Home.*PVS/i,   'HVOL-H'],
    [/High Volatility.*Away|Away.*PVS/i,   'HVOL-A'],
    [/DH G2|Doubleheader/i,                'DH-G2'],
    [/Wind.*Ace Veto/i,                    'W-ACE✗'],
    [/Home Fortress/i,                     'FORTRESS'],
    [/Division Race/i,                     'DIV-RACE'],
    [/Wild Card Race/i,                    'WC-RACE'],
    [/Elimination Game/i,                  'ELIM'],
    [/Regression Risk/i,                   'RCF'],
    [/P4_VETO|Road Ace.*BAN/i,             'P4_VETO'],
    [/P7_SKIP|Hot Batting.*SKIP/i,         'P7_SKIP'],
    [/P8_BAN|venue.*cold.*UNDER.*ban/i,    'P8_BAN'],
    [/P1_MATCH|Dome.*dual/i,               'P1'],
    [/P2_MATCH/i,                          'P2'],
    [/P10_MATCH|projected.*≤6\.5/i,        'P10'],
    [/Early Season Calibration.*April 1.14/i, 'CAL-A'],
    [/April Calibration.*April 15/i,       'CAL-B'],
  ];

  if (r.active_flags) {
    try {
      const af = typeof r.active_flags === 'string' ? JSON.parse(r.active_flags) : r.active_flags;
      const list = Array.isArray(af) ? af : [af];
      list.forEach(f => {
        const fStr = String(f);
        for (const [re, code] of FLAG_MAP) {
          if (re.test(fStr)) { flags.push(code); break; }
        }
      });
    } catch (_) {}
  }

  // Pull betting/pattern flags from full_prediction JSON
  if (r.full_prediction) {
    try {
      const fp = typeof r.full_prediction === 'string' ? JSON.parse(r.full_prediction) : r.full_prediction;

      // v2.8 betting_flags
      const bf = fp.betting_flags;
      if (bf) {
        if (bf.ml_bet_result && !/pass/i.test(bf.ml_bet_result)) flags.push('ML✓');
        if (/BLOCKED|FAIL/i.test(bf.flag2_gate_a || '')) flags.push('GATE-A✗');
        if (/BLOCKED|FAIL/i.test(bf.flag3_gate_b || '')) flags.push('GATE-B✗');
        if (/FAIL/i.test(bf.flag4_gate_c || ''))         flags.push('GATE-C✗');
        if (/FAIL/i.test(bf.flag5_gate_d || ''))         flags.push('GATE-D✗');
        if (/FAIL/i.test(bf.flag6_gate_e || ''))         flags.push('GATE-E✗');
        if (/ACTIVE/i.test(bf.flag9_venue_ban || ''))    flags.push('P8_BAN');
        if (/P4_VETO/i.test(bf.flag10_conf_cap || ''))   flags.push('P4_VETO');
        if (/P9_BAN/i.test(bf.flag10_conf_cap || ''))    flags.push('P9_BAN');
        if (bf.pattern_tier && bf.pattern_tier !== 'null') flags.push(bf.pattern_tier.replace(' ','_'));
      }

      // v2.7 pattern_matches fallback
      const pm = fp.pattern_matches;
      if (pm && !bf) {
        if (pm.P1_dome_dual_ace)       flags.push('P1');
        if (pm.P2_home_ace_mid_offence)flags.push('P2');
        if (pm.P3_cold_natural_grass)  flags.push('P3');
        if (pm.P4_road_ace_veto)       flags.push('P4_VETO');
        if (pm.P7_hot_batting_skip)    flags.push('P7_SKIP');
        if (pm.P8_venue_cold_under_ban)flags.push('P8_BAN');
        if (pm.P9_high_confidence_cap) flags.push('P9_BAN');
        if (pm.P10_projected_total_lte65) flags.push('P10');
        if (pm.pattern_tier && pm.pattern_tier !== 'null') flags.push(pm.pattern_tier.replace(' ','_'));
      }

      // Confidence deductions — extract short code before the colon
      const KNOWN = new Set(['PDCF','MCF','HFCF','TMF','HVIF','HSGV','KHA','VMF','ESDU','BSS','AOP','SWR','AHP','KXF','HBTF','RAF','HCB','VCB','ENV_BLOCK','EST_HIGH']);
      const cd = fp.confidence_deductions;
      if (Array.isArray(cd)) cd.forEach(d => {
        const code = String(d).split(':')[0].trim().replace(/\(.*\)/,'').trim();
        if (KNOWN.has(code)) flags.push(code);
      });
    } catch (_) {}
  }

  // Deduplicate
  const seen = new Set();
  const unique = flags.filter(f => { if (!f || seen.has(f)) return false; seen.add(f); return true; });

  if (!unique.length) return `<span style="color:var(--text3);font-size:0.7rem">—</span>`;

  // Color-code: ban flags red, positive flags green, default blue
  const BAN_FLAGS  = new Set(['P4_VETO','P7_SKIP','P8_BAN','P9_BAN','GATE-A✗','GATE-B✗','GATE-C✗','GATE-D✗','GATE-E✗','PDCF','MCF','HFCF','TMF','RAF','HCB','VCB','ENV_BLOCK','EST_HIGH']);
  const GOOD_FLAGS = new Set(['ML✓','P1','P2','P10','Pattern_A','Pattern_B','Strong_Under','WPOvr-A','WPOvr-B','SURGE-H','SURGE-A','FORTRESS']);

  const MAX = 5;
  const visible = unique.slice(0, MAX);
  const overflow = unique.length - MAX;
  const tooltip = unique.join(' | ');

  const chips = visible.map(f => {
    const cls = BAN_FLAGS.has(f) ? 'flag-chip flag-ban' : GOOD_FLAGS.has(f) ? 'flag-chip flag-ok' : 'flag-chip';
    return `<span class="${cls}" title="${esc(tooltip)}">${esc(f)}</span>`;
  }).join('');

  const more = overflow > 0 ? `<span class="flag-more" title="${esc(tooltip)}">+${overflow}</span>` : '';

  return chips + more;
}

// ─── Rule detection (mirrors export_with_rules.js logic) ─────────────────────
const RULE_SIGNAL_KWS = [
  'surging','slumping','lean over','strong over','lean under','strong under',
  'over bias','under bias','wind out','wind in','ou-a','ou-b','ou-c','ou-d','ou-e',
  'rcf+slump','cold hammer','p10_match','dome over','was home',
  'p12_','p13_','p14_','p15_','p18_','p20_','p22_','p24_','p25_'
];

const RULE_META = {
  R1:  { label:'R1',  title:'No-Flag Skip — 0 O/U signals active (25.8% accuracy)', cls:'rule-skip'    },
  R2:  { label:'R2',  title:'Line 9.0–10.0 + OVER elite zone (73.3%)',               cls:'rule-elite'   },
  R3:  { label:'R3',  title:'Single O/U signal — clean alignment (55.7%)',            cls:'rule-ok'      },
  R4:  { label:'R4',  title:'WP-Override A + UNDER (66.7% O/U, 84.6% ML)',           cls:'rule-elite'   },
  R5:  { label:'R5',  title:'PVS > 15 + OVER (68.2%, n=44)',                         cls:'rule-ok'      },
  R5W: { label:'R5⚠', title:'PVS > 15 + UNDER WARNING — only 38.1% hit rate',       cls:'rule-warn'    },
  R6:  { label:'R6',  title:'UNDER sweet spot 8.0–9.0 (59.5%)',                      cls:'rule-ok'      },
  R7:  { label:'R7',  title:'GVI 65+ OVER route (60.6–61.1%)',                       cls:'rule-ok'      },
  R7W: { label:'R7⚠', title:'GVI 65+ UNDER WARNING — 0% hit rate at GVI ≥ 65',      cls:'rule-warn'    },
  R8:  { label:'R8',  title:'MCF active — skip ML (42.1%), slight O/U edge (52.8%)', cls:'rule-warn'    },
  R9:  { label:'R9',  title:'Wind OUT — skip ML (43.5%), bet OVER O/U (69.0%)',      cls:'rule-ok'      },
  R10: { label:'R10', title:'Conf 60–64 O/U sweet spot (63.9%)',                     cls:'rule-ok'      },
};

function detectRules(r) {
  const flags    = (() => { try { return JSON.parse(r.active_flags    || '[]'); } catch(_){ return []; } })();
  const overrides= (() => { try { return JSON.parse(r.active_overrides|| '[]'); } catch(_){ return []; } })();
  const allText  = [...flags, ...overrides].join('|').toLowerCase();
  const ouLine   = parseFloat(r.ou_line) || 0;
  const conf     = r.confidence_score || 0;
  const gvi      = r.gvi || 0;
  const ouPred   = (r.ou_prediction || '').toUpperCase();
  const hPvs     = r.home_pvs || 0;
  const aPvs     = r.away_pvs || 0;

  const sigCount = RULE_SIGNAL_KWS.filter(kw => allText.includes(kw)).length;
  const matched  = [];

  if (sigCount === 0 && ouPred)                                           matched.push('R1');
  if (ouLine >= 9.0 && ouLine < 10.0 && ouPred === 'OVER' && sigCount >= 1) matched.push('R2');
  if (sigCount === 1)                                                     matched.push('R3');
  const hasOvrA = allText.includes('override a') || allText.includes('wp-override a') || allText.includes('wpo-a');
  if (hasOvrA && ouPred === 'UNDER')                                      matched.push('R4');
  const hasPvs  = hPvs > 15 || aPvs > 15 || allText.includes('pvs > 15') || allText.includes('high volatility');
  if (hasPvs && ouPred === 'OVER')                                        matched.push('R5');
  if (hasPvs && ouPred === 'UNDER')                                       matched.push('R5W');
  if (ouLine >= 8.0 && ouLine < 9.0 && ouPred === 'UNDER')               matched.push('R6');
  if (gvi >= 65 && ouPred === 'OVER')                                     matched.push('R7');
  if (gvi >= 65 && ouPred === 'UNDER')                                    matched.push('R7W');
  const hasMcf  = allText.includes('mcf') || allText.includes('model contradiction');
  if (hasMcf)                                                             matched.push('R8');
  const hasWind = allText.includes('wind out') || allText.includes('wind blowing out') || allText.includes('ou-b over');
  if (hasWind)                                                            matched.push('R9');
  if (conf >= 60 && conf <= 64 && ouPred)                                 matched.push('R10');

  return matched;
}

function buildRules(r) {
  const rules = detectRules(r);
  if (!rules.length) return '<span style="color:var(--text3);font-size:0.75rem">—</span>';
  return rules.map(key => {
    const m = RULE_META[key];
    if (!m) return '';
    return `<span class="rule-chip ${m.cls}" title="${esc(m.title)}">${m.label}</span>`;
  }).join('');
}

function renderRow(r) {
  const predWinner = r.home_win_pct >= r.away_win_pct ? r.home_team : r.away_team;
  const predWinPct = Math.max(r.home_win_pct || 0, r.away_win_pct || 0);

  const actualStr = r.actual_home_score != null
    ? `${r.home_team} ${r.actual_home_score} – ${r.actual_away_score} ${r.away_team}`
    : `<span style="color:var(--text3)">Pending</span>`;

  const mlBadge = r.ml_correct === 1
    ? `<span class="badge badge--win">WIN</span>`
    : r.ml_correct === 0
      ? `<span class="badge badge--loss">LOSS</span>`
      : `<span class="badge badge--pending">—</span>`;

  const ouBadge = r.ou_correct === 1
    ? `<span class="badge badge--win">WIN</span>`
    : r.ou_correct === 0
      ? `<span class="badge badge--loss">LOSS</span>`
      : r.ou_result === "PUSH"
        ? `<span class="badge badge--push">PUSH</span>`
        : `<span class="badge badge--pending">—</span>`;

  const confColor = (r.confidence_score || 0) >= 70
    ? "var(--green)" : (r.confidence_score || 0) >= 50
      ? "var(--gold)" : "var(--red)";

  const seasonBadge = r.season_type === "Postseason"
    ? `<span class="s-badge s-badge--post">PS</span>`
    : `<span class="s-badge s-badge--reg">RS</span>`;

  const gameDate = r.game_date ? r.game_date.slice(0, 10) : r.saved_at.slice(0, 10);

  return `
    <tr class="${r.ml_correct === 1 ? 'row--win' : r.ml_correct === 0 ? 'row--loss' : ''}">
      <td class="td-id">${r.id}</td>
      <td class="td-date">${esc(gameDate)}</td>
      <td class="td-matchup">
        <div class="matchup-cell">
          <span class="away-name">${esc(r.away_team || "—")}</span>
          <span class="at-sign">@</span>
          <span class="home-name">${esc(r.home_team || "—")}</span>
        </div>
        <div class="starter-cell">${esc(r.away_starter || "?")} vs ${esc(r.home_starter || "?")}</div>
      </td>
      <td>${seasonBadge}</td>
      <td class="td-pred">
        <span class="pred-winner">${esc(predWinner)}</span>
        <span class="pred-pct">${predWinPct}%</span>
      </td>
      <td class="td-ou">
        <span class="ou-call ${r.ou_prediction === 'OVER' ? 'ou-over' : 'ou-under'}">${esc(r.ou_prediction || "—")}</span>
        <span class="ou-line-sm">${esc(r.ou_line || "")}</span>
        ${r.ou_over_pct != null ? `<span class="ou-conf-pct" title="Confidence to be a low-scoring game">${r.ou_prediction === 'OVER' ? 100 - r.ou_over_pct : r.ou_over_pct}% low</span>` : ''}
      </td>
      <td style="color:${confColor};font-weight:700">${r.confidence_score ?? "—"}</td>
      <td class="td-actual">${actualStr}</td>
      <td>${mlBadge}</td>
      <td>${ouBadge}</td>
      <td class="td-flags">${buildFlags(r)}</td>
      <td class="td-rules">${buildRules(r)}</td>
      <td class="td-actions">
        ${r.ml_correct === null
          ? `<button class="btn-enter-result" onclick="openModalById(${r.id})">Enter Result</button>`
          : `<button class="btn-enter-result btn-reenter" onclick="openModalById(${r.id})">Edit</button>`
        }
        <button class="btn-del" onclick="deletePred(${r.id})" title="Delete">✕</button>
      </td>
    </tr>`;
}

function renderPagination(total, page, limit) {
  totalPages = Math.ceil(total / limit);
  const el = document.getElementById("pagination");
  if (totalPages <= 1) { el.innerHTML = ""; return; }

  let html = "";
  if (page > 1) html += `<button class="pg-btn" onclick="loadHistory(${page - 1})">← Prev</button>`;
  html += `<span class="pg-info">Page ${page} of ${totalPages} · ${total} total</span>`;
  if (page < totalPages) html += `<button class="pg-btn" onclick="loadHistory(${page + 1})">Next →</button>`;
  el.innerHTML = html;
}

// ─── Result Modal ─────────────────────────────────────────────────────────────
// Safe modal opener — looks up row data by ID to avoid inline string escaping issues
let _rowCache = {};
function openModalById(id) {
  const r = _rowCache[id];
  if (!r) return;
  openModal(r.id, r.away_team, r.home_team, r.ou_prediction, r.ou_line, r.home_win_pct, r.away_win_pct);
}

function openModal(id, away, home, ouPred, ouLine, homePct, awayPct) {
  activePredId = id;
  const predWinner = homePct >= awayPct ? home : away;
  const predPct    = Math.max(homePct, awayPct);

  document.getElementById("modalMatchup").textContent = `${away} @ ${home} · #${id}`;
  document.getElementById("homeScoreLabel").textContent = `${home} Score (Home)`;
  document.getElementById("awayScoreLabel").textContent = `${away} Score (Away)`;
  document.getElementById("modalPredRow").innerHTML = `
    <div class="mpred-item">
      <span class="mpred-lbl">Predicted Winner</span>
      <span class="mpred-val">${esc(predWinner)} (${predPct}%)</span>
    </div>
    <div class="mpred-item">
      <span class="mpred-lbl">O/U Prediction</span>
      <span class="mpred-val ${ouPred === 'OVER' ? 'ou-over' : 'ou-under'}">${esc(ouPred)} ${esc(ouLine)}</span>
    </div>`;

  document.getElementById("homeScore").value  = "";
  document.getElementById("awayScore").value  = "";
  document.getElementById("resultNotes").value = "";
  document.getElementById("modalError").classList.add("hidden");
  document.getElementById("modal").classList.remove("hidden");
  document.getElementById("homeScore").focus();
}

function closeModal(e) {
  if (e.target.id === "modal") document.getElementById("modal").classList.add("hidden");
}

async function submitResult() {
  const homeScore = document.getElementById("homeScore").value;
  const awayScore = document.getElementById("awayScore").value;
  const notes     = document.getElementById("resultNotes").value;
  const errEl     = document.getElementById("modalError");

  if (homeScore === "" || awayScore === "") {
    errEl.textContent = "Both scores are required.";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    const res  = await fetch(`/api/result/${activePredId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actual_home_score: parseFloat(homeScore),
        actual_away_score: parseFloat(awayScore),
        notes,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    document.getElementById("modal").classList.add("hidden");
    // Recalculate all accuracy metrics and reload table immediately
    await Promise.all([loadStats(), loadHistory(currentPage)]);
    document.getElementById("histTable").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    errEl.textContent = "Error: " + err.message;
    errEl.classList.remove("hidden");
  }
}

async function deletePred(id) {
  if (!confirm(`Delete prediction #${id}? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/predictions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    loadStats();
    loadHistory(currentPage);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Manual Entry Modal ───────────────────────────────────────────────────────
let _manualTab = "export";

function openManualEntry() {
  document.getElementById("exportStringInput").value = "";
  document.getElementById("jsonInput").value = "";
  document.getElementById("manualDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("manualSeasonType").value = "Regular Season";
  document.getElementById("manualNotes").value = "";
  document.getElementById("exportPreview").classList.add("hidden");
  document.getElementById("manualError").classList.add("hidden");
  switchManualTab("export");
  document.getElementById("manualModal").classList.remove("hidden");
  document.getElementById("exportStringInput").focus();
}

function closeManualModal(e) {
  if (e.target.id === "manualModal") document.getElementById("manualModal").classList.add("hidden");
}

function switchManualTab(tab) {
  _manualTab = tab;
  document.getElementById("panelExport").classList.toggle("hidden", tab !== "export");
  document.getElementById("panelJson").classList.toggle("hidden", tab !== "json");
  document.getElementById("tabExport").classList.toggle("manual-tab--active", tab === "export");
  document.getElementById("tabJson").classList.toggle("manual-tab--active", tab === "json");
}

function parseExportString(str) {
  const parts = str.split(",").map(s => s.trim());
  if (parts.length < 7) return null;
  const atIdx = parts[0].indexOf(" @ ");
  if (atIdx === -1) return null;
  const away = parts[0].slice(0, atIdx).trim();
  const home = parts[0].slice(atIdx + 3).trim();
  const homePct = parseInt(parts[3]) || null;
  const awayPct = parseInt(parts[4]) || null;
  const line    = parts[5] || null;
  const ouPctM  = (parts[6] || "").match(/(\d+)%/);
  const ouDirM  = (parts[6] || "").match(/\((Over|Under)\)/i);
  return {
    away_team:     away,
    home_team:     home,
    home_starter:  parts[1] || null,
    away_starter:  parts[2] || null,
    home_win_pct:  homePct,
    away_win_pct:  awayPct,
    ou_line:       line,
    ou_over_pct:   ouPctM ? parseInt(ouPctM[1]) : null,
    ou_prediction: ouDirM ? ouDirM[1].toUpperCase() : null,
  };
}

function previewExportString() {
  const raw = document.getElementById("exportStringInput").value.trim();
  const previewEl = document.getElementById("exportPreview");
  if (!raw) { previewEl.classList.add("hidden"); return; }
  const p = parseExportString(raw);
  if (!p || !p.home_team) {
    previewEl.className = "manual-preview manual-preview--error";
    previewEl.textContent = "Cannot parse — check format: Away @ Home, Home SP, Away SP, 56%, 44%, 8.5, 61% (Over)";
    return;
  }
  const ouDir = p.ou_prediction || "—";
  const ouColor = ouDir === "OVER" ? "var(--accent2)" : "var(--blue)";
  previewEl.className = "manual-preview";
  previewEl.innerHTML = `
    <div class="mp-row"><span class="mp-lbl">Matchup</span><span class="mp-val">${esc(p.away_team)} @ ${esc(p.home_team)}</span></div>
    <div class="mp-row"><span class="mp-lbl">Starters</span><span class="mp-val">${esc(p.away_starter)} vs ${esc(p.home_starter)}</span></div>
    <div class="mp-row"><span class="mp-lbl">Win%</span><span class="mp-val">${esc(p.home_team)} ${p.home_win_pct ?? "—"}% · ${esc(p.away_team)} ${p.away_win_pct ?? "—"}%</span></div>
    <div class="mp-row"><span class="mp-lbl">O/U</span><span class="mp-val" style="color:${ouColor}">${ouDir} ${esc(p.ou_line)} (${p.ou_over_pct ?? "—"}% Over)</span></div>`;
}

async function submitManualEntry() {
  const errEl = document.getElementById("manualError");
  errEl.classList.add("hidden");

  const game_date   = document.getElementById("manualDate").value;
  const season_type = document.getElementById("manualSeasonType").value;
  const notes       = document.getElementById("manualNotes").value;

  if (!game_date) {
    errEl.textContent = "Game date is required.";
    errEl.classList.remove("hidden");
    return;
  }

  let body;
  if (_manualTab === "export") {
    const export_string = document.getElementById("exportStringInput").value.trim();
    if (!export_string) {
      errEl.textContent = "Paste an export string first.";
      errEl.classList.remove("hidden");
      return;
    }
    body = { type: "export_string", export_string, game_date, season_type, notes };
  } else {
    const json_text = document.getElementById("jsonInput").value.trim();
    if (!json_text) {
      errEl.textContent = "Paste JSON first.";
      errEl.classList.remove("hidden");
      return;
    }
    body = { type: "json", json_text, game_date, season_type, notes };
  }

  try {
    const res  = await fetch("/api/manual-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    document.getElementById("manualModal").classList.add("hidden");
    await Promise.all([loadStats(), loadHistory(1)]);
    document.getElementById("histTable").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    errEl.textContent = "Error: " + err.message;
    errEl.classList.remove("hidden");
  }
}
