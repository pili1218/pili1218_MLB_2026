// ─── State ───────────────────────────────────────────────────────────────────
let files = [];
let lastResult = null;
let lastPrediction = null;
let selectedModel = "claude-sonnet-4-6"; // default

// Load prediction count badge on page load
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res  = await fetch("/api/stats");
    const json = await res.json();
    const badge = document.getElementById("navBadge");
    if (badge && json.total > 0) {
      badge.textContent = json.total;
      badge.style.display = "inline-block";
    }
  } catch (_) { /* silent */ }
});

// ─── Model Selector ───────────────────────────────────────────────────────────
function selectModel(btn) {
  document.querySelectorAll(".model-card").forEach(c => c.classList.remove("model-card--active"));
  btn.classList.add("model-card--active");
  selectedModel = btn.dataset.model;
  document.getElementById("footerModel").textContent = selectedModel;
}

// ─── Drag & Drop ─────────────────────────────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById("dropZone").classList.add("dragover");
}

function handleDragLeave(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.remove("dragover");
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.remove("dragover");
  const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
  addFiles(dropped);
}

function handleFileSelect(e) {
  addFiles(Array.from(e.target.files));
  e.target.value = "";
}

function addFiles(newFiles) {
  const combined = [...files, ...newFiles].slice(0, 10);
  files = combined;
  renderPreviews();
}

function removeFile(idx) {
  files.splice(idx, 1);
  renderPreviews();
}

function renderPreviews() {
  const grid = document.getElementById("previewGrid");
  const bar = document.getElementById("analyzeBar");
  const countEl = document.getElementById("fileCount");

  if (files.length === 0) {
    grid.classList.add("hidden");
    bar.classList.add("hidden");
    grid.innerHTML = "";
    return;
  }

  grid.classList.remove("hidden");
  bar.classList.remove("hidden");
  countEl.textContent = `${files.length} image${files.length > 1 ? "s" : ""} selected`;

  grid.innerHTML = files.map((file, i) => {
    const url = URL.createObjectURL(file);
    return `
      <div class="preview-item">
        <img src="${url}" alt="${file.name}" />
        <button class="preview-remove" onclick="removeFile(${i})" title="Remove">×</button>
        <div class="preview-label">${file.name}</div>
      </div>`;
  }).join("");
}

// ─── Analyze ─────────────────────────────────────────────────────────────────
async function analyzeImages() {
  if (files.length === 0) return;

  const btn = document.getElementById("analyzeBtn");
  btn.disabled = true;

  showStatus("Uploading images to server…");
  hideResult();

  const formData = new FormData();
  files.forEach(f => formData.append("images", f));
  formData.append("model", selectedModel);

  try {
    const modelLabel = document.querySelector(`.model-card--active .model-name`)?.textContent || selectedModel;
    updateStatus(`Analyzing with ${modelLabel}…`);
    const res = await fetch("/api/analyze", { method: "POST", body: formData });
    const json = await res.json();

    if (!res.ok || json.error) {
      throw new Error(json.error || `Server error ${res.status}`);
    }

    lastResult = json.data;
    const v = json.verify;
    if (v) {
      const label = v.remaining_issues.length === 0
        ? `✓ Verified clean after ${v.passes} pass${v.passes > 1 ? "es" : ""}`
        : `⚠ ${v.remaining_issues.length} minor issue(s) remain after ${v.passes} passes`;
      updateStatus(label);
      await new Promise(r => setTimeout(r, 900));
    }
    showResult(json.data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    hideStatus();
  }
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function showStatus(msg) {
  document.getElementById("status").classList.remove("hidden");
  document.getElementById("statusText").textContent = msg;
}
function updateStatus(msg) {
  document.getElementById("statusText").textContent = msg;
}
function hideStatus() {
  document.getElementById("status").classList.add("hidden");
}
function hideResult() {
  document.getElementById("resultSection").classList.add("hidden");
}

function showError(msg) {
  const status = document.getElementById("status");
  status.classList.remove("hidden");
  status.innerHTML = `
    <div style="color:var(--red);font-size:2rem;">✕</div>
    <p style="color:var(--red);font-weight:600;">Analysis Failed</p>
    <p style="color:var(--text2);font-size:0.875rem;">${escapeHtml(msg)}</p>
    <button onclick="hideStatus()" style="margin-top:8px;padding:8px 20px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;">Dismiss</button>
  `;
}

// ─── Result rendering ─────────────────────────────────────────────────────────
function showResult(data) {
  document.getElementById("resultSection").classList.remove("hidden");
  document.getElementById("resultMeta").textContent =
    `${data.game_date || ""}  ${data.game_time || ""}`;

  renderGameSummary(data);
  renderJSON(data);

  // Reveal the Deep Analysis panel and reset it
  const ps = document.getElementById("predictSection");
  ps.classList.remove("hidden");
  document.getElementById("predictResult").classList.add("hidden");
  document.getElementById("predictStatus").classList.add("hidden");
  document.getElementById("predictBtn").disabled = false;

  document.getElementById("resultSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderGameSummary(data) {
  const el = document.getElementById("gameSummary");
  const home = data.home_team || "Home";
  const away = data.away_team || "Away";
  const hStats = data.team_stats?.home || {};
  const aStats = data.team_stats?.away || {};
  const hPitch = data.starters?.home || {};
  const aPitch = data.starters?.away || {};
  const weather = data.weather || {};
  const betting = data.betting || {};

  const streakClass = (s) => {
    if (!s) return "";
    if (s.toLowerCase().includes("win")) return "win";
    if (s.toLowerCase().includes("loss")) return "loss";
    return "";
  };

  el.innerHTML = `
    <div class="matchup-header">
      <div class="team-name">${escapeHtml(away)}</div>
      <div class="vs-badge">@ VS @</div>
      <div class="team-name">${escapeHtml(home)}</div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Venue</div>
        <div class="summary-value">${escapeHtml(data.venue || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Weather</div>
        <div class="summary-value">${escapeHtml([weather.temperature, weather.condition, weather.wind_speed].filter(Boolean).join(" · ") || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Run Line</div>
        <div class="summary-value gold">${escapeHtml(betting.line || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Over / Under</div>
        <div class="summary-value gold">${escapeHtml(betting.over_under || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${escapeHtml(home)} Record (Home)</div>
        <div class="summary-value">${escapeHtml(hStats.home_record || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${escapeHtml(away)} Record (Away)</div>
        <div class="summary-value">${escapeHtml(aStats.away_record || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${escapeHtml(home)} Last 10</div>
        <div class="summary-value">${escapeHtml(hStats.last_10 || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${escapeHtml(away)} Last 10</div>
        <div class="summary-value">${escapeHtml(aStats.last_10 || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${escapeHtml(home)} Streak</div>
        <div class="summary-value ${streakClass(hStats.streak)}">${escapeHtml(hStats.streak || "—")}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${escapeHtml(away)} Streak</div>
        <div class="summary-value ${streakClass(aStats.streak)}">${escapeHtml(aStats.streak || "—")}</div>
      </div>
    </div>

    <div class="pitcher-row">
      ${renderPitcherCard(hPitch, home, "Home Starter")}
      ${renderPitcherCard(aPitch, away, "Away Starter")}
    </div>
  `;
}

function renderPitcherCard(p, team, side) {
  if (!p.name) return `<div class="pitcher-card"><div class="pitcher-side">${escapeHtml(side)}</div><div class="pitcher-name" style="color:var(--text3)">—</div></div>`;
  return `
    <div class="pitcher-card">
      <div class="pitcher-side">${escapeHtml(side)} · ${escapeHtml(team)}</div>
      <div class="pitcher-name">${escapeHtml(p.name)} <span style="color:var(--text3);font-size:0.8rem;font-weight:400">${escapeHtml(p.handedness || "")}</span></div>
      <div class="pitcher-stats">
        <div class="pstat"><div class="pstat-val">${escapeHtml(p.era || "—")}</div><div class="pstat-lbl">ERA</div></div>
        <div class="pstat"><div class="pstat-val">${escapeHtml(p.whip || "—")}</div><div class="pstat-lbl">WHIP</div></div>
        <div class="pstat"><div class="pstat-val">${escapeHtml(p.win_loss || "—")}</div><div class="pstat-lbl">W-L</div></div>
        <div class="pstat"><div class="pstat-val">${escapeHtml(p.strikeouts || "—")}</div><div class="pstat-lbl">K</div></div>
        <div class="pstat"><div class="pstat-val">${escapeHtml(p.innings_pitched || "—")}</div><div class="pstat-lbl">IP</div></div>
      </div>
    </div>`;
}

// ─── JSON syntax highlighting ─────────────────────────────────────────────────
function syntaxHighlight(json) {
  const str = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      match => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span class="json-key">${match}</span>`;
          return `<span class="json-str">${match}</span>`;
        }
        if (/true|false/.test(match)) return `<span class="json-bool">${match}</span>`;
        if (/null/.test(match)) return `<span class="json-null">${match}</span>`;
        return `<span class="json-num">${match}</span>`;
      }
    );
}

function renderJSON(data) {
  document.getElementById("jsonOutput").innerHTML = syntaxHighlight(data);
}

// ─── Copy / Download ──────────────────────────────────────────────────────────
function copyJSON() {
  if (!lastResult) return;
  const text = JSON.stringify(lastResult, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copyBtn");
    btn.classList.add("copied");
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="btn-icon"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg> Copied!`;
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="btn-icon"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg> Copy`;
    }, 2000);
  });
}

function downloadJSON() {
  if (!lastResult) return;
  const text = JSON.stringify(lastResult, null, 2);
  const home = lastResult.home_team || "home";
  const away = lastResult.away_team || "away";
  const date = lastResult.game_date || "game";
  const filename = `${away.replace(/\s+/g, "_")}_vs_${home.replace(/\s+/g, "_")}_${date}.json`;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function analyzeAnother() {
  clearAll();
  hideResult();
  document.getElementById("predictSection").classList.add("hidden");
  document.getElementById("predictResult").classList.add("hidden");
  lastPrediction = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearAll() {
  files = [];
  renderPreviews();
}

// ─── Deep Analysis ────────────────────────────────────────────────────────────

async function runDeepAnalysis() {
  if (!lastResult) return;

  const btn = document.getElementById("predictBtn");
  btn.disabled = true;

  const statusEl = document.getElementById("predictStatus");
  statusEl.classList.remove("hidden");
  statusEl.innerHTML = `<div class="spinner-sm"></div><span>Analyzing with ${escapeHtml(selectedModel)}…</span>`;
  document.getElementById("predictResult").classList.add("hidden");

  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameData: lastResult, model: selectedModel }),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || `Server error ${res.status}`);

    lastPrediction = json.data;
    const v = json.verify;
    if (v) {
      const label = v.remaining_issues.length === 0
        ? `✓ Prediction verified clean after ${v.passes} pass${v.passes > 1 ? "es" : ""}`
        : `⚠ ${v.remaining_issues.length} minor issue(s) remain after ${v.passes} passes`;
      statusEl.innerHTML = `<span style="color:${v.remaining_issues.length === 0 ? 'var(--green)' : 'var(--gold)'}">${label}</span>`;
      await new Promise(r => setTimeout(r, 900));
    }
    showPrediction(json.data);
  } catch (err) {
    statusEl.innerHTML = `
      <div style="color:var(--red);font-size:1.5rem">✕</div>
      <p style="color:var(--red);font-weight:600">Analysis Failed</p>
      <p style="color:var(--text2);font-size:0.875rem">${escapeHtml(err.message)}</p>
      <button onclick="document.getElementById('predictStatus').classList.add('hidden')"
        style="margin-top:8px;padding:6px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer;">
        Dismiss
      </button>`;
  } finally {
    btn.disabled = false;
  }
}

function showPrediction(data) {
  document.getElementById("predictStatus").classList.add("hidden");
  const el = document.getElementById("predictResult");
  el.classList.remove("hidden");

  renderWinProbability(data);
  renderOUConf(data);
  renderBetStrategy(data);
  renderMetrics(data);
  renderFlags(data);
  renderNarrative(data);
  renderExport(data);

  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderWinProbability(data) {
  const home = escapeHtml(data.home_team || "Home");
  const away = escapeHtml(data.away_team || "Away");
  const homeP = data.home_win_pct || 50;
  const awayP = data.away_win_pct || 50;

  document.getElementById("winProbSection").innerHTML = `
    <div class="prob-row">
      <div class="prob-team-label">${away} <span class="road-tag">AWAY</span></div>
      <div class="prob-track"><div class="prob-fill ${awayP >= homeP ? "prob-fill--lead" : ""}" style="width:${awayP}%"></div></div>
      <div class="prob-pct ${awayP > homeP ? "prob-pct--lead" : ""}">${awayP}%</div>
    </div>
    <div class="prob-row">
      <div class="prob-team-label">${home} <span class="home-tag">HOME</span></div>
      <div class="prob-track"><div class="prob-fill ${homeP > awayP ? "prob-fill--lead" : ""}" style="width:${homeP}%"></div></div>
      <div class="prob-pct ${homeP >= awayP ? "prob-pct--lead" : ""}">${homeP}%</div>
    </div>
  `;
}

function renderOUConf(data) {
  const ou = data.ou_prediction || "—";
  const ouConf = data.ou_confidence || "Low";
  const ouLine = data.ou_line || "—";
  const conf = data.confidence_score || 0;

  const ouColor = ou === "OVER" ? "#e05c3a" : "#3a8fe0";
  const ouArrow = ou === "OVER" ? "↑" : "↓";

  const confColor = conf >= 70 ? "var(--green)" : conf >= 50 ? "var(--gold)" : "var(--red)";
  const confLabel = conf >= 70 ? "High Confidence" : conf >= 50 ? "Moderate Confidence" : "Low Confidence";

  const deductions = (data.confidence_deductions || []).map(d =>
    `<li class="ded-item">${escapeHtml(d)}</li>`
  ).join("");

  document.getElementById("ouSection").innerHTML = `
    <div class="ou-card" style="--ou-color:${ouColor}">
      <div class="ou-arrow">${ouArrow}</div>
      <div class="ou-word">${escapeHtml(ou)}</div>
      <div class="ou-line-val">O/U ${escapeHtml(ouLine)}</div>
      <div class="ou-conf-badge">${escapeHtml(ouConf)} Confidence</div>
    </div>`;

  document.getElementById("confSection").innerHTML = `
    <div class="conf-card">
      <div class="conf-score-row">
        <span class="conf-num" style="color:${confColor}">${conf}</span>
        <span class="conf-max">/100</span>
      </div>
      <div class="conf-label" style="color:${confColor}">${confLabel}</div>
      <div class="conf-track"><div class="conf-fill" style="width:${conf}%;background:${confColor}"></div></div>
      ${deductions ? `<ul class="ded-list">${deductions}</ul>` : ""}
    </div>`;
}

function renderMetrics(data) {
  const items = [
    { label: "GVI",       value: data.gvi,       note: data.gvi > 65 ? "OVER bias" : data.gvi < 35 ? "UNDER bias" : null },
    { label: "Home TMS",  value: data.home_tms,  note: null },
    { label: "Away TMS",  value: data.away_tms,  note: null },
    { label: "Home PMS",  value: data.home_pms,  note: null },
    { label: "Away PMS",  value: data.away_pms,  note: null },
    { label: "Home PVS",  value: data.home_pvs != null ? (+data.home_pvs).toFixed(1) : "—",
      note: data.home_pvs > 15 ? "High Volatility" : null },
    { label: "Away PVS",  value: data.away_pvs != null ? (+data.away_pvs).toFixed(1) : "—",
      note: data.away_pvs > 15 ? "High Volatility" : null },
    { label: "Home RED",  value: data.home_red != null ? (data.home_red > 0 ? "+" : "") + (+data.home_red).toFixed(2) : "—",
      note: data.home_red < -1 ? "Surging" : data.home_red > 1.5 ? "Slumping" : null },
    { label: "Away RED",  value: data.away_red != null ? (data.away_red > 0 ? "+" : "") + (+data.away_red).toFixed(2) : "—",
      note: data.away_red < -1 ? "Surging" : data.away_red > 1.5 ? "Slumping" : null },
  ];

  document.getElementById("metricsSection").innerHTML = items.map(m => {
    const noteColor = m.note === "Surging" ? "var(--green)" : m.note === "Slumping" ? "var(--red)" : "var(--gold)";
    return `
      <div class="metric-chip">
        <div class="mc-label">${escapeHtml(m.label)}</div>
        <div class="mc-value">${m.value != null ? escapeHtml(String(m.value)) : "—"}</div>
        ${m.note ? `<div class="mc-note" style="color:${noteColor}">${escapeHtml(m.note)}</div>` : ""}
      </div>`;
  }).join("");
}

function renderFlags(data) {
  const flags = data.active_flags || [];
  const overrides = (data.active_overrides || []).filter(o => o !== "None" && o !== "none");
  const all = [...flags, ...overrides];

  if (all.length === 0) {
    document.getElementById("flagsSection").innerHTML =
      `<span style="color:var(--text3);font-size:0.85rem">No active flags</span>`;
    return;
  }

  document.getElementById("flagsSection").innerHTML = all.map(f => {
    const lo = f.toLowerCase();
    const color = (lo.includes("slumping") || lo.includes("pdcf") || lo.includes("meltdown") || lo.includes("regression") || lo.includes("mcf"))
      ? "var(--red)"
      : (lo.includes("surging") || lo.includes("fortress") || lo.includes("momentum"))
        ? "var(--green)"
        : "var(--gold)";
    return `<span class="flag-chip" style="color:${color};border-color:${color}25;background:${color}0a">${escapeHtml(f)}</span>`;
  }).join("");
}

function renderBetStrategy(data) {
  const rec = data.betting_recommendation || deriveBettingRec(data);
  const lo = rec.toLowerCase();
  const isStrong   = lo.includes("strong");
  const isModerate = lo.includes("moderate");
  const isPass     = lo.includes("no strong") || lo.includes("pass");

  const [color, tier] = isStrong
    ? ["var(--green)", "Strong Play"]
    : isModerate
      ? ["var(--gold)", "Moderate Play"]
      : isPass
        ? ["var(--text3)", "Pass — No Strong Play"]
        : ["var(--blue)", "Lean"];

  document.getElementById("betSection").innerHTML = `
    <div class="bet-box" style="--bet-color:${color}">
      <div class="bet-tier">${tier}</div>
      <div class="bet-rec">${escapeHtml(rec)}</div>
    </div>`;
}

function deriveBettingRec(data) {
  const home = data.home_team || "Home";
  const away = data.away_team || "Away";
  const homeP = data.home_win_pct || 50;
  const awayP = data.away_win_pct || 50;
  const conf  = data.confidence_score || 0;
  const ou    = data.ou_prediction || "OVER";
  const ouConf = data.ou_confidence || "Low";
  const ouLine = data.ou_line || "—";

  const fav = homeP >= awayP ? home : away;
  const favP = Math.max(homeP, awayP);

  let ml;
  if      (favP >= 62 && conf >= 65) ml = `Strong lean: ${fav} Moneyline`;
  else if (favP >= 56 && conf >= 58) ml = `Moderate lean: ${fav} Moneyline`;
  else if (favP >= 53 && conf >= 50) ml = `Slight lean: ${fav} Moneyline`;
  else                                ml = "No strong moneyline play";

  const totals = (ouConf === "High" || ouConf === "Moderate") && conf >= 55
    ? `${ou} ${ouLine} (${ouConf})`
    : `Slight lean ${ou} ${ouLine} (low conviction)`;

  return `${ml}  ·  ${totals}`;
}

function renderNarrative(data) {
  const driver   = data.key_driver || "";
  const reasoning = data.reasoning || "";
  document.getElementById("narrativeSection").innerHTML = `
    ${driver   ? `<div class="narr-driver">${escapeHtml(driver)}</div>` : ""}
    ${reasoning ? `<p  class="narr-text">${escapeHtml(reasoning)}</p>` : ""}`;
}

function renderExport(data) {
  const exp = data.export_string || "";
  document.getElementById("exportSection").innerHTML = `
    <div class="export-row">
      <code class="export-code">${escapeHtml(exp)}</code>
      <button class="btn-copy-exp" onclick="copyExportStr()">Copy</button>
    </div>`;
}

async function savePrediction() {
  if (!lastPrediction) return;
  const btn = document.getElementById("saveBtn");
  const statusEl = document.getElementById("saveStatus");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const res = await fetch("/api/save-prediction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prediction: lastPrediction,
        game_date: lastResult?.game_date || null,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "Save failed");

    statusEl.className = "save-status save-status--ok";
    statusEl.innerHTML = `Saved as prediction #${json.id}. <a href="/history">View in History →</a>`;
    statusEl.classList.remove("hidden");
    btn.textContent = "Saved ✓";
    // Refresh nav badge
    try {
      const sr = await fetch("/api/stats");
      const sj = await sr.json();
      const badge = document.getElementById("navBadge");
      if (badge && sj.total > 0) { badge.textContent = sj.total; badge.style.display = "inline-block"; }
    } catch (_) { /* silent */ }
  } catch (err) {
    statusEl.className = "save-status save-status--err";
    statusEl.textContent = "Save failed: " + err.message;
    statusEl.classList.remove("hidden");
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="btn-icon"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293z"/></svg> Save Prediction`;
  }
}

function copyExportStr() {
  if (!lastPrediction) return;
  navigator.clipboard.writeText(lastPrediction.export_string || "").then(() => {
    const btn = document.querySelector(".btn-copy-exp");
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy"; }, 2000); }
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
