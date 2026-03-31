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

  if (!rows.length) {
    wrap.innerHTML = `<div class="hist-loading" style="color:var(--text3)">No predictions saved yet. Run a deep analysis and click "Save Prediction".</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="hist-table">
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
          <th class="th-inv">Investigation</th>
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
      </td>
      <td style="color:${confColor};font-weight:700">${r.confidence_score ?? "—"}</td>
      <td class="td-actual">${actualStr}</td>
      <td>${mlBadge}</td>
      <td>${ouBadge}</td>
      <td class="td-investigation">${buildInvestigation(r)}</td>
      <td class="td-actions">
        ${r.ml_correct === null
          ? `<button class="btn-enter-result" onclick="openModal(${r.id}, '${esc(r.away_team)}', '${esc(r.home_team)}', '${esc(r.ou_prediction)}', '${esc(r.ou_line)}', ${r.home_win_pct}, ${r.away_win_pct})">Enter Result</button>`
          : `<button class="btn-enter-result btn-reenter" onclick="openModal(${r.id}, '${esc(r.away_team)}', '${esc(r.home_team)}', '${esc(r.ou_prediction)}', '${esc(r.ou_line)}', ${r.home_win_pct}, ${r.away_win_pct})">Edit</button>`
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
    // Recalculate all accuracy metrics immediately
    loadStats();
    loadHistory(currentPage);
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
