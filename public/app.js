// ─── State ───────────────────────────────────────────────────────────────────
let files = [];
let lastResult = null;
let lastPrediction = null;
let selectedModel = "claude-sonnet-5"; // default

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

  // Changelog toggle
  const toggle = document.getElementById("changelogToggle");
  const body   = document.getElementById("changelogBody");
  const chev   = document.getElementById("changelogChevron");
  if (toggle && body && chev) {
    toggle.addEventListener("click", () => {
      const open = !body.classList.contains("hidden");
      body.classList.toggle("hidden", open);
      chev.classList.toggle("open", !open);
    });
  }
});

// ─── Model Selector ───────────────────────────────────────────────────────────
function selectModel(btn) {
  document.querySelectorAll(".model-card").forEach(c => c.classList.remove("model-card--active"));
  btn.classList.add("model-card--active");
  selectedModel = btn.dataset.model;
  document.getElementById("footerModel").textContent = selectedModel;
}

// ─── Input Tab Switcher ───────────────────────────────────────────────────────
function switchInputTab(tab) {
  const isScreenshots = tab === 'screenshots';
  document.getElementById('tabScreenshots').classList.toggle('input-tab--active', isScreenshots);
  document.getElementById('tabJsonText').classList.toggle('input-tab--active', !isScreenshots);
  document.getElementById('panelScreenshots').classList.toggle('hidden', !isScreenshots);
  document.getElementById('panelJsonText').classList.toggle('hidden', isScreenshots);
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

    lastResult = normalizeGameData(json.data);
    const v = json.verify;
    if (v) {
      const label = v.remaining_issues.length === 0
        ? `✓ Verified clean after ${v.passes} pass${v.passes > 1 ? "es" : ""}`
        : `⚠ ${v.remaining_issues.length} minor issue(s) remain after ${v.passes} passes`;
      updateStatus(label);
      await new Promise(r => setTimeout(r, 900));
    }
    showResult(lastResult);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    hideStatus();
  }
}

// ─── JSON / Text Panel ───────────────────────────────────────────────────────
function handleJsonDragOver(e) {
  e.preventDefault();
  document.getElementById('jsonDropZone').classList.add('dragover');
}
function handleJsonDragLeave(e) {
  e.preventDefault();
  document.getElementById('jsonDropZone').classList.remove('dragover');
}
function handleJsonDrop(e) {
  e.preventDefault();
  document.getElementById('jsonDropZone').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) readJsonFile(file);
}
function handleJsonFileSelect(e) {
  const file = e.target.files[0];
  if (file) readJsonFile(file);
  e.target.value = '';
}
function readJsonFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('jtPasteBox').value = ev.target.result;
    handlePasteInput();
  };
  reader.readAsText(file);
}
function handlePasteInput() {
  const val = document.getElementById('jtPasteBox').value.trim();
  const bar = document.getElementById('jtActionBar');
  const status = document.getElementById('jtStatus');
  const btnLabel = document.getElementById('jtBtnLabel');
  if (!val) { bar.style.display = 'none'; status.textContent = ''; return; }
  bar.style.display = 'flex';
  try {
    JSON.parse(val);
    status.textContent = '✓ Valid JSON detected — will load directly';
    status.className = 'jt-paste-hint jt-valid';
    btnLabel.textContent = 'Load JSON';
  } catch (_) {
    status.textContent = '⚡ Plain text — AI will extract game data';
    status.className = 'jt-paste-hint jt-text';
    btnLabel.textContent = 'Parse with AI';
  }
}
async function loadJsonText() {
  const val = document.getElementById('jtPasteBox').value.trim();
  if (!val) return;
  let parsed;
  try {
    parsed = JSON.parse(val);
    // Single-element array — unwrap
    if (Array.isArray(parsed) && parsed.length === 1) parsed = parsed[0];
    // Multi-game array — show picker
    if (Array.isArray(parsed) && parsed.length > 1) {
      showGamePicker(parsed);
      return;
    }
    // Valid single object — skip analyze, use directly
    lastResult = normalizeGameData(parsed);
    showResult(lastResult);
    return;
  } catch (_) { /* not JSON — send to AI */ }
  // Plain text path — send to /api/parse-text
  const btn = document.getElementById('jtLoadBtn');
  btn.disabled = true;
  showStatus('Parsing text with AI…');
  hideResult();
  try {
    const res = await fetch('/api/parse-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: val, model: selectedModel }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || `Server error ${res.status}`);
    lastResult = normalizeGameData(json.data);
    showResult(lastResult);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    hideStatus();
  }
}
function showGamePicker(games) {
  const container = document.getElementById('resultSection') || document.querySelector('.result-section');
  const pickerId = 'gamePicker';
  document.getElementById(pickerId)?.remove();

  const div = document.createElement('div');
  div.id = pickerId;
  div.className = 'game-picker';
  div.innerHTML = `
    <div class="game-picker-title">Multiple games detected — select one to analyze:</div>
    <div class="game-picker-list">
      ${games.map((g, i) => `
        <button class="game-picker-btn" onclick="selectPickedGame(${i})">
          <span class="gp-time">${g.game_time || 'Game ' + (i + 1)}</span>
          <span class="gp-matchup">${g.away_team || '?'} @ ${g.home_team || '?'}</span>
          <span class="gp-sp">${g.starters?.away?.name || '?'} vs ${g.starters?.home?.name || '?'}</span>
        </button>
      `).join('')}
    </div>`;

  const anchor = document.getElementById('jtActionBar') || document.getElementById('panelJsonText');
  anchor?.parentNode?.insertBefore(div, anchor.nextSibling);
  window._pickerGames = games;
}

function selectPickedGame(index) {
  const game = window._pickerGames?.[index];
  if (!game) return;
  document.getElementById('gamePicker')?.remove();
  lastResult = normalizeGameData(game);
  showResult(lastResult);
}

function clearJsonText() {
  document.getElementById('jtPasteBox').value = '';
  document.getElementById('jtActionBar').style.display = 'none';
  document.getElementById('jtStatus').textContent = '';
  hideResult();
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

  // Reveal the notes input and Deep Analysis panel, reset both
  document.getElementById("notesSection").classList.remove("hidden");
  document.getElementById("extraNotes").value = "";

  const ps = document.getElementById("predictSection");
  ps.classList.remove("hidden");
  document.getElementById("predictResult").classList.add("hidden");
  document.getElementById("predictStatus").classList.add("hidden");
  document.getElementById("predictBtn").disabled = false;

  document.getElementById("resultSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function patchOULine(val) {
  const v = parseFloat(val);
  if (!lastResult || isNaN(v)) return;
  if (!lastResult.betting) lastResult.betting = {};
  lastResult.betting.over_under = String(v);
  const inp = document.getElementById('ouManualInput');
  if (inp) inp.classList.toggle('ou-manual-input--set', !!val);
}

function showOUInput() {
  const disp = document.getElementById('ouDisplayVal');
  const inp  = document.getElementById('ouManualInput');
  if (disp) disp.style.display = 'none';
  if (inp)  inp.classList.remove('hidden');
  inp?.focus();
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
        ${(!betting.over_under || betting.over_under === '-' || betting.over_under === '—')
          ? `<input id="ouManualInput" class="ou-manual-input" type="number" step="0.5" min="5" max="20"
               placeholder="Enter line e.g. 8.5"
               oninput="patchOULine(this.value)"
               title="O/U line not found — enter manually">`
          : `<div class="summary-value gold" id="ouDisplayVal">${escapeHtml(betting.over_under)}
               <button class="ou-edit-btn" onclick="showOUInput()" title="Edit O/U line">✎</button>
             </div>
             <input id="ouManualInput" class="ou-manual-input hidden" type="number" step="0.5" min="5" max="20"
               value="${escapeHtml(betting.over_under)}"
               oninput="patchOULine(this.value)">`
        }
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
  document.getElementById("notesSection").classList.add("hidden");
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
    const extraNotes = document.getElementById("extraNotes").value.trim();
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameData: lastResult, model: selectedModel, extraNotes }),
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

  // Always reset save button so re-runs of analysis don't leave it disabled
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" class="btn-icon"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293z"/></svg> Save Prediction`;
  }
  document.getElementById("saveStatus").classList.add("hidden");

  renderWinProbability(data);
  renderOUConf(data);
  renderBetStrategy(data);
  renderMetrics(data);
  renderFlags(data);
  renderCombos(data);
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

function renderCombos(data) {
  const el = document.getElementById("comboSection");
  const block = document.getElementById("comboBlock");
  if (!el) return;

  const COMBO_META = {
    // ── ML Combos (1363-game, through Jul 27) — WP-Override family (WPA+WPB) anchors 7 of 10 ──
    MC1:  { label:"MC1",  type:"ml",   pct:"94%",  n:16,  title:"Home pred + GVI<35 + Dome",                       tip:"ML 93.8% n=16 · stable #1 all season. ML $75 only — skip O/U (37.5%)." },
    MC2:  { label:"MC2",  type:"ml",   pct:"90%",  n:20,  title:"Home pred + WP-Override A + UNDER",               tip:"ML 90.0% n=20 · zero recorded both-wrong games — most trustworthy dual play. O/U 57.9%. ML $75 + UNDER $75." },
    MC3:  { label:"MC3",  type:"ml",   pct:"88%",  n:17,  title:"OU-A fired + GVI<35 + Dome",                      tip:"ML 88.2% n=17 · pitcher-form signal in suppressed dome. ML $75 only — skip O/U (29.4%)." },
    MC4:  { label:"MC4",  type:"ml",   pct:"87%",  n:15,  title:"Home Fortress + WP-Override A + Line 8–9",        tip:"ML 86.7% n=15 · CAUTION: collapses to 50% both-wrong when away_surge co-fires — confirm absent first. O/U 60%. ML $75 + O/U direction $50." },
    MC5:  { label:"MC5",  type:"ml",   pct:"86%",  n:14,  title:"TMS home higher + GVI<35 + Dome",                 tip:"ML 85.7% n=14 · home momentum + suppressed dome. ML $75 only — skip O/U (28.6%)." },
    MC6:  { label:"MC6",  type:"ml",   pct:"86%",  n:21,  title:"WP-Override A + UNDER + Line 8–9",                tip:"ML 85.7% n=21 · BEST DUAL-MARKET, zero recorded both-wrong games. O/U 66.7%. ML $75 + UNDER $75." },
    MC7:  { label:"MC7",  type:"ml",   pct:"86%",  n:14,  title:"WP-Override B + Line 8–9 + Conf 50–55",           tip:"ML 85.7% n=14 · WPB at sweet-spot line + calibrated confidence. Pure ML (OU 35.7%). ML $75 only." },
    MC8:  { label:"MC8",  type:"ml",   pct:"85%",  n:13,  title:"WP-Override B + UNDER + Conf 50–55",              tip:"ML 84.6% n=13 · WPB + UNDER + calibrated confidence. O/U 46.2%. ML $75 + UNDER $37.50." },
    MC9:  { label:"MC9",  type:"ml",   pct:"85%",  n:13,  title:"WP-Override B + Dome + RCF",                      tip:"ML 84.6% n=13 · WPB + dome + xFIP correction. O/U 63.6%. ML $75 + O/U direction $50." },
    MC10: { label:"MC10", type:"ml",   pct:"84%",  n:25,  title:"Home pred + WP gap ≥20% + WP-Override A ★",       tip:"ML 84.0% n=25★ · largest sample of any top-10 ML combo. Pure ML (OU 50%). ML $75 only." },
    // ── O/U Combos (1363-game) — away_surge now anchors 4 of the top 10 ──
    OC1:  { label:"OC1",  type:"ou",   pct:"81%",  n:16,  title:"Conf 50–55 + GVI<35 + RCF",                       tip:"O/U 81.2% n=16 · calibrated conf + suppressed GVI + regression risk. ML 50% — skip ML. O/U $75 only." },
    OC2:  { label:"OC2",  type:"ou",   pct:"75%",  n:12,  title:"OU-B fired + GVI≥65 + Surging Away SP",           tip:"O/U 75.0% n=12 · away_surge is a broken ML signal (33.3%) but useful for O/U here. Skip ML. O/U $75 only." },
    OC3:  { label:"OC3",  type:"ou",   pct:"75%",  n:12,  title:"GVI≥65 + Surging Away SP + MCF",                  tip:"O/U 75.0% n=12 · AND ML 57.1% (n=14) — both markets viable despite away_surge's usual ML risk. O/U $75 + ML $50." },
    OC4:  { label:"OC4",  type:"ou",   pct:"73%",  n:15,  title:"UNDER + Line 8–9 + Surging Away SP",              tip:"O/U 73.3% n=15 · UNDER framing works better than OVER with away_surge (see reverse O/U FDOU4). ML 52.9%. UNDER $75 + ML $37.50." },
    OC5:  { label:"OC5",  type:"ou",   pct:"73%",  n:11,  title:"WP-Override B + OU-B + Dome",                     tip:"O/U 72.7% n=11 · WPB + environmental + dome. ML 66.7%. O/U $75 + ML $50." },
    OC6:  { label:"OC6",  type:"ou",   pct:"72%",  n:18,  title:"TMS home higher + WP-Override A + RCF",           tip:"O/U 72.2% n=18 · home momentum + WPA + regression risk. ML 57.9% (n=19). O/U $75 + ML $50." },
    OC7:  { label:"OC7",  type:"ou",   pct:"72%",  n:18,  title:"WP-Override B + OU-B + UNDER",                    tip:"O/U 72.2% n=18 · WPB + environmental + UNDER direction. ML 55.6%. UNDER $75 + ML $37.50." },
    OC8:  { label:"OC8",  type:"ou",   pct:"71%",  n:14,  title:"RED mismatch >1.5 + Conf 50–55 + GVI<35",         tip:"O/U 71.4% n=14 · SP gap + calibrated conf + suppressed GVI. ML 64.3%. O/U $75 + ML $50." },
    OC9:  { label:"OC9",  type:"ou",   pct:"71%",  n:31,  title:"Conf 50–55 + Dome + RCF ★",                       tip:"O/U 71.0% n=31★ LARGEST SAMPLE IN O/U TOP 10 · AND 60.6% ML — most trustworthy recurring dual play by volume. O/U $75 + ML $75." },
    OC10: { label:"OC10", type:"ou",   pct:"71%",  n:14,  title:"WP gap ≥20% + Away surge + MCF",                  tip:"O/U 71.4% n=14 · same combo type flagged as an ML fade — confirmed strong for O/U specifically. ML weak (33.3%) — skip ML. O/U $75 only." },
    // ── Reverse ML Signals (1363-game) — away_surge anchors all 10; REVERSE the model's actual named team ──
    FD1:  { label:"FD1",  type:"fade", pct:"83%",  n:12,  title:"HFCF + WP-Override A + Away surge",               tip:"STRONGEST fade this update (83.3%, n=12). Model named HOME all 12x (fully one-sided). REVERSE → bet AWAY ML $75. Skip O/U." },
    FD2:  { label:"FD2",  type:"fade", pct:"80%",  n:20,  title:"OU-A fired + OU-B + Away surge ⚠",                tip:"80.0% fade (n=20). MIXED — model named home 8x, away 12x. Also a top-5 both-wrong combo (50% BW) — consider a full PASS over a confident reverse. Skip O/U." },
    FD3:  { label:"FD3",  type:"fade", pct:"78%",  n:18,  title:"TMS home higher + RCF + Away surge",              tip:"77.8% fade (n=18). MIXED — model named home 11x, away 7x. Check actual rec first, then REVERSE it." },
    FD4:  { label:"FD4",  type:"fade", pct:"77%",  n:13,  title:"WP gap ≥20% + TMS home higher + Away surge ⚠",    tip:"76.9% fade (n=13). MIXED. Also a top-5 both-wrong combo (53.8% BW) — reverse cautiously, not as clean as the fade% suggests." },
    FD5:  { label:"FD5",  type:"fade", pct:"77%",  n:13,  title:"Home Fortress + Away surge + MCF",                tip:"76.9% fade (n=13). Mostly away (11 of 13). Check actual rec first, then REVERSE it — usually the home fortress side." },
    FD6:  { label:"FD6",  type:"fade", pct:"77%",  n:17,  title:"HFCF + OU-A fired + Away surge",                  tip:"76.5% fade (n=17). Fully one-sided — model named home 0x, away 17x. REVERSE → consistently the home team here." },
    FD7:  { label:"FD7",  type:"fade", pct:"75%",  n:12,  title:"WP-Override A + OU-B + Away surge",               tip:"75.0% fade (n=12). Mostly away (11 of 12). REVERSE → usually bet HOME." },
    FD8:  { label:"FD8",  type:"fade", pct:"75%",  n:12,  title:"Dome + Away surge + MCF",                         tip:"75.0% fade (n=12). Mostly away (11 of 12). REVERSE → usually bet HOME." },
    FD9:  { label:"FD9",  type:"fade", pct:"73%",  n:40,  title:"OU-B + Line 8–9 + Away surge ★",                  tip:"LARGEST-SAMPLE fade (72.5%, n=40★). MIXED — model named home 10x, away 30x. Check actual rec first, then REVERSE it. Skip O/U." },
    FD10: { label:"FD10", type:"fade", pct:"72%",  n:18,  title:"OU-A fired + TMF + Away surge",                   tip:"72.2% fade (n=18). Mostly away (15 of 18). REVERSE → usually bet HOME." },
    // ── Reverse O/U Signals (NEW v3.15, 1363-game) — flips the O/U call itself, not the ML pick ──
    FDOU1:  { label:"FDOU1",  type:"fadeou", pct:"86%", n:14, title:"GVI≥65 + Conf 55–65 + Away surge",             tip:"Strongest O/U fade found (85.7%, n=14). Model called OVER 11x, UNDER 3x — mostly OVER-named. REVERSE the model's called direction." },
    FDOU2:  { label:"FDOU2",  type:"fadeou", pct:"85%", n:13, title:"TMS home higher + Conf 55–65 + Away surge",    tip:"84.6% fade (n=13). Genuinely mixed — called OVER 7x, UNDER 6x. Verify each game's actual call." },
    FDOU3:  { label:"FDOU3",  type:"fadeou", pct:"84%", n:19, title:"RED mismatch + Conf 55–65 + Away surge ★",     tip:"LARGEST-SAMPLE O/U fade (84.2%, n=19★). Called OVER 11x, UNDER 8x — mixed. Always verify the actual call before flipping." },
    FDOU4:  { label:"FDOU4",  type:"fadeou", pct:"78%", n:18, title:"OVER pred + Conf 55–65 + Away surge",          tip:"77.8% fade (n=18). By definition all 18 are OVER-named — fully one-sided. REVERSE → bet UNDER $75, unambiguous." },
    FDOU5:  { label:"FDOU5",  type:"fadeou", pct:"79%", n:14, title:"OU-B + GVI<35 + TMF ⚠ opposite direction",     tip:"78.6% fade (n=14). Called UNDER 12x, OVER 2x — rare combo where UNDER is the failing call. REVERSE → bet OVER $75." },
    FDOU6:  { label:"FDOU6",  type:"fadeou", pct:"76%", n:21, title:"UNDER pred + GVI<35 + TMF ⚠ opposite",         tip:"76.2% fade (n=21). All 21 UNDER-named by definition. Most reliable \"UNDER fails\" signal — REVERSE → bet OVER $75." },
    FDOU7:  { label:"FDOU7",  type:"fadeou", pct:"75%", n:16, title:"WP gap ≥20% + WP-Override B + GVI≥65",         tip:"75.0% fade (n=16). Nearly one-sided OVER (15 of 16). REVERSE → bet UNDER $75 in almost every case." },
    FDOU8:  { label:"FDOU8",  type:"fadeou", pct:"77%", n:17, title:"Slumping SP + WP-Override B + Line 8–9",       tip:"76.5% fade (n=17). Mixed — called OVER 10x, UNDER 7x. Verify each game before flipping." },
    FDOU9:  { label:"FDOU9",  type:"fadeou", pct:"75%", n:12, title:"HFCF + Home Fortress + WP-Override B",         tip:"75.0% fade (n=12). Mixed — called OVER 5x, UNDER 7x. Fine for ML, but fade the O/U call specifically." },
    FDOU10: { label:"FDOU10", type:"fadeou", pct:"79%", n:14, title:"Conf 55–65 + Surging SP + Away surge ⚠ caveat", tip:"78.6% fade (n=14). Mixed — called OVER 8x, UNDER 6x. Source analysis may double-count the same underlying signal — treat with reduced confidence pending re-verification." },
    // ── Both-Correct Signals (NEW v3.16, 1239-game joint analysis) — bet BOTH markets together ──
    BC1: { label:"BC1", type:"bc", pct:"58%", n:12, title:"WP-Override A + Line 8–9 + Conf 50–55",   tip:"BC 58.3% n=12 · only 1/12 both-wrong — strongest joint signal found. BET BOTH: ML $75 + O/U direction $75." },
    BC2: { label:"BC2", type:"bc", pct:"52%", n:21, title:"WP-Override A + UNDER + Line 8–9",         tip:"BC 52.4% n=21 · 0/21 both-wrong — never produced a joint loss. BET BOTH: ML $75 + UNDER $75." },
    BC3: { label:"BC3", type:"bc", pct:"55%", n:20, title:"Slumping SP + UNDER + RCF",                tip:"BC 55.0% n=20 · only 2/20 both-wrong. BET BOTH: ML $75 + UNDER $75." },
    BC4: { label:"BC4", type:"bc", pct:"47%", n:19, title:"Home pred + WP-Override A + UNDER",        tip:"BC 47.4% n=19 · 0/19 both-wrong — second zero-BW combo, confirms WPA+UNDER as the framework's most reliable dual-market backbone. BET BOTH: ML $75 + UNDER $75." },
    BC5: { label:"BC5", type:"bc", pct:"52%", n:23, title:"Conf 50–55 + UNDER + TMF",                 tip:"BC 52.2% n=23 · largest sample in the BC top tier. BET BOTH: ML $75 + UNDER $75." },
    BC6: { label:"BC6", type:"bc", pct:"54%", n:13, title:"HFCF + GVI<35",                            tip:"BC 53.8% n=13 · cleanest 2-flag BC signal. BET BOTH: ML $75 + O/U direction $75." },
    BC7: { label:"BC7", type:"bc", pct:"41%", n:83, title:"Golden Condition + Conf 50–55 ★",          tip:"BC 41.0% n=83★ largest sample of any BC combo — still well above the 26.5% baseline. BET BOTH: ML $75 + O/U direction $75." }
  };

  // ── Both-Wrong Signals (NEW v3.16, 1239-game) — hard double-PASS override, not a fade ──
  const BW_META = {
    BW1: { label:"BW1", pct:"60%", n:15, title:"Surging Away SP + Golden Condition",               tip:"BW 60.0% n=15 · worst combo in the dataset. Golden Condition normally a strong O/U signal, but a surging away arm poisons both markets together." },
    BW2: { label:"BW2", pct:"62%", n:13, title:"OVER + Line 8–9 + Surging Away SP",                tip:"BW 61.5% n=13 · worst 3-flag combo found — automatic double-skip." },
    BW3: { label:"BW3", pct:"57%", n:14, title:"HFCF + WP-Override A + OVER",                       tip:"BW 57.1% n=14 · HFCF+WPA individually strong ML signals, but paired with OVER, both markets fail together more than half the time." },
    BW4: { label:"BW4", pct:"54%", n:13, title:"WP gap≥20% + TMS home higher + Away surge RED",     tip:"BW 53.8% n=13 · large WP gap + home momentum overridden by the away pitcher's genuine surge." },
    BW5: { label:"BW5", pct:"50%", n:12, title:"HFCF + WP-Override A + Away surge RED",             tip:"BW 50.0% n=12 · same HFCF+WPA pairing as BW3, poisoned by away_surge instead of OVER — needs a \"no away_surge / no OVER\" guard." },
    BW6: { label:"BW6", pct:"50%", n:12, title:"Home Fortress + Away surge RED + MCF",              tip:"BW 50.0% n=12 · three-way collision: home proven strong + away pitcher hot + market disagrees." },
    BW7: { label:"BW7", pct:"50%", n:20, title:"OU-A + OU-B + Surging Away SP ★",                   tip:"BW 50.0% n=20★ largest sample — the most statistically trustworthy double-skip signal in the dataset." }
  };

  // ── Team-specific signal correlations (931-game, min n=8 per flag) ─────────
  const TEAM_META = {
    TEX: { name:"Texas Rangers",        flag:"Golden Condition", pct:"92%", n:12, ou:"66.7%" },
    LAD: { name:"Los Angeles Dodgers",  flag:"TMF active",       pct:"89%", n:9,  ou:"44.4%" },
    NYM: { name:"New York Mets",        flag:"GVI<35",           pct:"88%", n:8,  ou:"42.9%" },
    KC:  { name:"Kansas City Royals",   flag:"UNDER pred",        pct:"87%", n:15, ou:"75.0%" },
    ATH: { name:"Athletics",            flag:"Conf 50–55",       pct:"86%", n:14, ou:"69.2%" },
    MIA: { name:"Miami Marlins",        flag:"Home pred",        pct:"84%", n:32, ou:"35.7%" },
    CWS: { name:"Chicago White Sox",    flag:"UNDER pred",        pct:"83%", n:18, ou:"35.3%" },
    NYY: { name:"New York Yankees",     flag:"TMF active",       pct:"80%", n:10, ou:"55.6%" },
    TB:  { name:"Tampa Bay Rays",       flag:"RCF active",       pct:"79%", n:19, ou:"44.4%" },
    DET: { name:"Detroit Tigers",       flag:"Conf 50–55",       pct:"77%", n:13, ou:"61.5%" },
    MIL: { name:"Milwaukee Brewers",    flag:"RCF active",       pct:"77%", n:13, ou:"50.0%" },
    STL: { name:"St. Louis Cardinals",  flag:"Home Fortress",    pct:"77%", n:13, ou:"58.3%" },
    ARI: { name:"Arizona Diamondbacks", flag:"WP-Override B",    pct:"75%", n:8,  ou:"42.9%" },
    BAL: { name:"Baltimore Orioles",    flag:"WP-Override B",    pct:"75%", n:8,  ou:"37.5%" },
    MIN: { name:"Minnesota Twins",      flag:"Dome",             pct:"75%", n:8,  ou:"25.0%" },
    PHI: { name:"Philadelphia Phillies",flag:"Home SP surging",  pct:"75%", n:8,  ou:"62.5%" },
    SEA: { name:"Seattle Mariners",     flag:"GVI<35",           pct:"75%", n:8,  ou:"75.0%" },
    CIN: { name:"Cincinnati Reds",      flag:"UNDER pred",        pct:"73%", n:15, ou:"42.9%" },
    COL: { name:"Colorado Rockies",     flag:"Home Fortress",    pct:"71%", n:14, ou:"50.0%" },
    BOS: { name:"Boston Red Sox",       flag:"Away pred",        pct:"71%", n:38, ou:"60.6%" },
    CLE: { name:"Cleveland Guardians",  flag:"Dome",             pct:"70%", n:10, ou:"44.4%" },
    SF:  { name:"San Francisco Giants", flag:"Dome",             pct:"70%", n:10, ou:"55.6%" },
    HOU: { name:"Houston Astros",       flag:"Surging SP",       pct:"67%", n:9,  ou:"77.8%" },
    TOR: { name:"Toronto Blue Jays",    flag:"Conf 50–55",       pct:"65%", n:17, ou:"60.0%" },
    SD:  { name:"San Diego Padres",     flag:"Home Fortress",    pct:"64%", n:14, ou:"50.0%" },
    CHC: { name:"Chicago Cubs",         flag:"WP gap ≥20%",      pct:"64%", n:11, ou:"36.4%" },
    PIT: { name:"Pittsburgh Pirates",   flag:"GVI<35",           pct:"63%", n:8,  ou:"25.0%" },
    WAS: { name:"Washington Nationals", flag:"Golden Condition", pct:"62%", n:13, ou:"69.2%" },
    ATL: { name:"Atlanta Braves",       flag:"GVI≥65",           pct:"60%", n:25, ou:"35.0%" },
    LAA: { name:"Los Angeles Angels",   flag:"PDCF active",      pct:"58%", n:12, ou:"50.0%" },
  };

  // ── Team-specific 2-flag combos (1229-game, top 10 teams, min n=8) ─────────
  const TEAM_COMBO_META = {
    ATH: { name:"Athletics",            combo:"GVI≥65 + Conf 50–55",          pct:"100%", n:8,  ou:"75.0%" },
    KC:  { name:"Kansas City Royals",   combo:"OU-B fired + UNDER pred",       pct:"100%", n:8,  ou:"50.0%" },
    MIA: { name:"Miami Marlins",        combo:"TMS home higher + UNDER pred",  pct:"100%", n:9,  ou:"22.2%" },
    NYM: { name:"New York Mets",        combo:"Home pred + UNDER pred",        pct:"92%",  n:12, ou:"36.4%" },
    STL: { name:"St. Louis Cardinals",  combo:"RCF active + Conf 50–55",       pct:"90%",  n:10, ou:"55.6%" },
    CWS: { name:"Chicago White Sox",    combo:"OU-A fired + UNDER pred",       pct:"91%",  n:11, ou:"40.0%" },
    MIL: { name:"Milwaukee Brewers",    combo:"OU-A fired + GVI≥65",           pct:"91%",  n:11, ou:"45.5%" },
    NYY: { name:"New York Yankees",     combo:"RED mismatch>1.5 + UNDER pred", pct:"91%",  n:11, ou:"63.6%" },
    TB:  { name:"Tampa Bay Rays",       combo:"RCF active + Home Fortress",    pct:"91%",  n:11, ou:"54.5%" },
    LAA: { name:"Los Angeles Angels",   combo:"Home pred + UNDER pred",        pct:"89%",  n:9,  ou:"50.0%" },
  };

  function parseArr(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v) { try { return JSON.parse(v); } catch(e) {} }
    return [];
  }
  const combos    = parseArr(data.combo_hits).filter(c => COMBO_META[c]);
  const fades     = parseArr(data.fade_signals).filter(c => COMBO_META[c]);
  const teams     = parseArr(data.team_signals).filter(t => TEAM_META[(t || "").split(":")[0]]);
  const teamCombos = parseArr(data.team_combo_signals).filter(t => TEAM_COMBO_META[(t || "").split(":")[0]]);
  const bwHits    = parseArr(data.bw_signals).filter(c => BW_META[c]);
  const all     = [...combos, ...fades, ...teams, ...teamCombos, ...bwHits];

  if (all.length === 0) {
    if (block) block.style.display = "none";
    return;
  }
  if (block) block.style.display = "";

  const mlHits    = combos.filter(c => COMBO_META[c].type === "ml");
  const ouHits    = combos.filter(c => COMBO_META[c].type === "ou");
  const bcHits    = combos.filter(c => COMBO_META[c].type === "bc");
  const fdHits    = fades.filter(c => COMBO_META[c].type === "fade");
  const fdouHits  = fades.filter(c => COMBO_META[c].type === "fadeou");

  function chipHTML(codes, bgColor, labelColor) {
    return codes.map(code => {
      const m = COMBO_META[code];
      return `<div class="combo-chip" style="--cc:${bgColor};--cl:${labelColor}" title="${escapeHtml(m.tip)}">
        <span class="combo-code">${escapeHtml(m.label)}</span>
        <span class="combo-title">${escapeHtml(m.title)}</span>
        <span class="combo-pct">${escapeHtml(m.pct)} n=${m.n}</span>
      </div>`;
    }).join("");
  }

  function bwChipHTML(codes, bgColor, labelColor) {
    return codes.map(code => {
      const m = BW_META[code];
      return `<div class="combo-chip" style="--cc:${bgColor};--cl:${labelColor}" title="${escapeHtml(m.tip)}">
        <span class="combo-code">${escapeHtml(m.label)}</span>
        <span class="combo-title">${escapeHtml(m.title)}</span>
        <span class="combo-pct">${escapeHtml(m.pct)} n=${m.n}</span>
      </div>`;
    }).join("");
  }

  function teamChipHTML(codes, bgColor, labelColor) {
    return codes.map(code => {
      const [abbr] = code.split(":");
      const m = TEAM_META[abbr];
      return `<div class="combo-chip" style="--cc:${bgColor};--cl:${labelColor}" title="${escapeHtml(m.name)} + ${escapeHtml(m.flag)} → O/U ${escapeHtml(m.ou)} (n=${m.n})">
        <span class="combo-code">${escapeHtml(abbr)}</span>
        <span class="combo-title">${escapeHtml(m.flag)}</span>
        <span class="combo-pct">${escapeHtml(m.pct)} n=${m.n}</span>
      </div>`;
    }).join("");
  }

  function teamComboChipHTML(codes, bgColor, labelColor) {
    return codes.map(code => {
      const [abbr] = code.split(":");
      const m = TEAM_COMBO_META[abbr];
      return `<div class="combo-chip" style="--cc:${bgColor};--cl:${labelColor}" title="${escapeHtml(m.name)} + ${escapeHtml(m.combo)} → O/U ${escapeHtml(m.ou)} (n=${m.n})">
        <span class="combo-code">${escapeHtml(abbr)}</span>
        <span class="combo-title">${escapeHtml(m.combo)}</span>
        <span class="combo-pct">${escapeHtml(m.pct)} n=${m.n}</span>
      </div>`;
    }).join("");
  }

  let html = '<div class="combo-wrap">';

  if (bwHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label" style="color:#e24b4a">🛑 PASS BOTH MARKETS — Both-Wrong signal active</div>`;
    html += `<div class="combo-chips">${bwChipHTML(bwHits, "rgba(226,75,74,.16)", "#e24b4a")}</div></div>`;
  }
  if (fdHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label fade-label">⚠ Reverse ML Signals Active — model's team pick may be reversed</div>`;
    html += `<div class="combo-chips">${chipHTML(fdHits, "rgba(226,75,74,.1)", "#e24b4a")}</div></div>`;
  }
  if (fdouHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label fadeou-label">⚠ Reverse O/U Signals Active — model's O/U call may be reversed</div>`;
    html += `<div class="combo-chips">${chipHTML(fdouHits, "rgba(127,119,221,.12)", "#7F77DD")}</div></div>`;
  }
  if (bcHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label ml-label">🎯 Both-Correct — Bet Both Markets</div>`;
    html += `<div class="combo-chips">${chipHTML(bcHits, "rgba(63,185,80,.15)", "#3fb950")}</div></div>`;
  }
  if (mlHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label ml-label">ML Combos</div>`;
    html += `<div class="combo-chips">${chipHTML(mlHits, "rgba(63,185,80,.1)", "#3fb950")}</div></div>`;
  }
  if (ouHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label ou-label">O/U Combos</div>`;
    html += `<div class="combo-chips">${chipHTML(ouHits, "rgba(55,138,221,.1)", "#378ADD")}</div></div>`;
  }
  if (teamCombos.length) {
    html += `<div class="combo-group"><div class="combo-group-label" style="color:#7F77DD">Team 2-Flag Combos</div>`;
    html += `<div class="combo-chips">${teamComboChipHTML(teamCombos, "rgba(127,119,221,.15)", "#7F77DD")}</div></div>`;
  }
  if (teams.length) {
    html += `<div class="combo-group"><div class="combo-group-label" style="color:#7F77DD">Team Signals</div>`;
    html += `<div class="combo-chips">${teamChipHTML(teams, "rgba(127,119,221,.1)", "#7F77DD")}</div></div>`;
  }

  html += "</div>";
  el.innerHTML = html;
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

// ─── JSON structure normalizer ────────────────────────────────────────────────
// Handles all known JSON schemas: flat, game_info-wrapped, and alternate schemas
// using starting_pitchers / team_recent_form / betting_lines / betting_odds keys.
function normalizeGameData(data) {
  if (!data || typeof data !== "object") return data;
  // Already flat — home_team is a plain string, starters and team_stats present
  if (typeof data.home_team === "string" && data.home_team && data.starters && data.team_stats) return data;

  // ── game_metadata / teams schema (e.g. sportsdata-style deep JSON) ─────────
  if (data.game_metadata || (data.teams && (data.teams.home_team || data.teams.away_team))) {
    const gm  = data.game_metadata || {};
    const tms = data.teams || {};
    const ht  = tms.home_team || {};
    const at  = tms.away_team || {};
    const bl  = data.betting_lines || {};
    const hSP = ht.starting_pitcher || {};
    const aSP = at.starting_pitcher || {};
    const hL10 = ht.last_10_games || {};
    const aL10 = at.last_10_games || {};
    const wRaw = gm.weather || data.weather || {};

    function spFromNested(sp) {
      const ss = sp.season_stats || {};
      return {
        name:                sp.name || "",
        handedness:          sp.throwing_hand || sp.handedness || "",
        era:                 String(ss.era != null ? ss.era : (sp.era != null ? sp.era : "")),
        whip:                String(ss.whip != null ? ss.whip : (sp.whip != null ? sp.whip : "")),
        win_loss:            ss.wins != null ? `${ss.wins}-${ss.losses}` : "",
        strikeouts:          String(ss.strikeouts ?? ""),
        innings_pitched:     String(ss.innings_pitched ?? ""),
        batting_avg_against: String(ss.opponent_batting_avg ?? ss.batting_avg_against ?? ""),
        walks:               String(ss.walks ?? ""),
        recent_games:        sp.recent_game_logs || sp.recent_games || [],
      };
    }

    return normalizeGameData({
      game_date:  gm.game_date  || gm.date  || "",
      game_time:  gm.game_time  || gm.time  || "",
      venue:      gm.venue      || gm.venue_name || gm.venue_type || data.venue || "",
      home_team:  ht.name || ht.abbreviation || "",
      away_team:  at.name || at.abbreviation || "",
      weather: {
        condition:   wRaw.condition   || "",
        temperature: wRaw.temperature_f ? `${wRaw.temperature_f}°F` : (wRaw.temperature || ""),
        wind_speed:  wRaw.wind_speed  || wRaw.wind || "",
        precipitation_chance_pct: wRaw.precipitation_chance_pct ?? "",
      },
      betting: {
        over_under: String(bl.over_under ?? bl.total ?? ""),
        line:       String(bl.moneyline ?? bl.run_line ?? bl.spread ?? bl.line ?? ""),
      },
      starters: { home: spFromNested(hSP), away: spFromNested(aSP) },
      team_stats: {
        home: {
          batting_avg:  ht.team_batting_splits?.this_season?.avg ?? "",
          on_base_pct:  ht.team_batting_splits?.this_season?.obp ?? "",
          avg_runs:     ht.season_avg_runs_scored ?? "",
          recent_form:  ht.overall_record || "",
          home_record:  ht.home_record || "",
          last_10:      hL10.record || "",
          streak:       ht.streak || "",
        },
        away: {
          batting_avg:  at.team_batting_splits?.this_season?.avg ?? "",
          on_base_pct:  at.team_batting_splits?.this_season?.obp ?? "",
          avg_runs:     at.season_avg_runs_scored ?? "",
          recent_form:  at.overall_record || "",
          away_record:  at.away_record || "",
          last_10:      aL10.record || "",
          streak:       at.streak || "",
        },
      },
      lineups: {
        home: ht.expected_lineup || [],
        away: at.expected_lineup || [],
      },
    });
  }

  // ── game_info + matchup_trends/pitching_matchup/team_batting_stats schema ──
  // (and its sibling variant: team_records_and_trends/starting_pitchers — same
  // source tool, different wrapper key names between runs)
  if (data.pitching_matchup || data.matchup_trends || data.team_batting_stats ||
      data.starting_pitchers || data.team_records_and_trends) {
    const gi2  = data.game_info || {};
    const mt   = data.matchup_trends || data.team_records_and_trends || {};
    const recs = mt.records || mt; // older variant nests under .records; newer is flat
    const pm   = data.pitching_matchup || data.starting_pitchers || {};
    const tbs  = data.team_batting_stats || {};
    const bo   = gi2.betting_odds || {};
    const stadiumInfo = gi2.stadium || gi2.venue || {};
    const wRaw2 = gi2.weather || data.weather || {};
    const precipMatch = String(wRaw2.precipitation || "").match(/^(\d+)%\s*(.*)$/);

    function teamKey(name) {
      return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    }
    const awayName = gi2.away_team?.name || gi2.away_team?.abbreviation || "";
    const homeName = gi2.home_team?.name || gi2.home_team?.abbreviation || "";
    const awayKey  = teamKey(awayName);
    const homeKey  = teamKey(homeName);

    const tbsKeys  = Object.keys(tbs).filter(k => k !== "columns_reference" && k !== "metrics");
    const tbsAway  = tbs[awayKey] || tbs[tbsKeys.find(k => k.startsWith("away_"))] || {};
    const tbsHome  = tbs[homeKey] || tbs[tbsKeys.find(k => k.startsWith("home_"))] || {};

    function stripRank(v) { return String(v ?? "").replace(/\(\d+\)\s*$/, "").trim(); }

    // Resolves a {away,home}-shaped lookup across every naming convention seen from
    // this source tool: plain away/home, team-name key, literal away_team/home_team,
    // team-name+suffix, or any away_*/home_*-prefixed key.
    function findTeamValue(obj, side) {
      if (!obj || typeof obj !== "object") return undefined;
      const nameKey = side === "away" ? awayKey : homeKey;
      const candidates = [obj[nameKey], obj[side], obj[`${side}_team`], obj[`${nameKey}_${side}`]];
      for (const c of candidates) if (c !== undefined) return c;
      const prefixKey = Object.keys(obj).find(k => k.startsWith(`${side}_`));
      return prefixKey ? obj[prefixKey] : undefined;
    }

    function parseLast10(str) {
      if (!str) return { last10: "", streak: "" };
      const rec = str.match(/^\d+-\d+/);
      const sk  = str.match(/\((\d+)\s*(Win|Loss)\s*Streak\)/i);
      return {
        last10: rec ? rec[0] : "",
        streak: sk ? `${sk[2][0].toUpperCase()}${sk[1]}` : "",
      };
    }
    function resolveLast10(raw) {
      if (raw && typeof raw === "object" && raw.record) {
        const streakStr = String(raw.streak || "");
        const sk   = streakStr.match(/\((\d+)\s*(Win|Loss)\s*Streak\)/i);
        const skCn = streakStr.match(/(\d+)\s*連\s*(勝|敗)/);
        const streak = sk ? `${sk[2][0].toUpperCase()}${sk[1]}` : skCn ? `${skCn[2] === "勝" ? "W" : "L"}${skCn[1]}` : "";
        return { last10: raw.record, streak };
      }
      return parseLast10(raw);
    }
    const last10Away = resolveLast10(findTeamValue(recs.last_10_games, "away"));
    const last10Home = resolveLast10(findTeamValue(recs.last_10_games, "home"));

    const overallAway   = findTeamValue(recs.overall, "away") ?? findTeamValue(recs.overall_record, "away") ?? "";
    const overallHome   = findTeamValue(recs.overall, "home") ?? findTeamValue(recs.overall_record, "home") ?? "";
    const awayRoadRecord = findTeamValue(recs.home_away_splits, "away") || "";
    const homeHomeRecord = findTeamValue(recs.home_away_splits, "home") || "";

    function pitcherFromMatchup(p) {
      if (!p) return {};
      const ss = p.season_stats || p.season_stats_legumina_detailed || p.season_stats_seymour_lineup || {};
      return {
        name:                p.name || p.name_primary_source || p.name_lineup_source || "",
        handedness:          p.throws || p.throws_lineup_source || p.handedness || "",
        era:                 String(ss.era ?? ""),
        whip:                String(ss.whip ?? ""),
        win_loss:            (ss.wins != null && ss.losses != null) ? `${ss.wins}-${ss.losses}` : "",
        strikeouts:          String(ss.so ?? ""),
        innings_pitched:     String(ss.ip ?? ""),
        batting_avg_against: ss.baa || "",
        walks:               String(ss.bb ?? ""),
        recent_games:        p.recent_starts || p.recent_starts_legumina || [],
      };
    }

    const elKeys = Object.keys(data.expected_lineups || {});

    return normalizeGameData({
      game_date:  gi2.date || "",
      game_time:  gi2.time || "",
      venue:      stadiumInfo.description || stadiumInfo.weather_conditions || stadiumInfo.type || stadiumInfo.stadium_type || "",
      home_team:  homeName,
      away_team:  awayName,
      weather: {
        condition:   precipMatch ? precipMatch[2] : "",
        temperature: wRaw2.temperature || "",
        wind_speed:  wRaw2.wind || "",
        precipitation_chance_pct: precipMatch ? precipMatch[1] : "",
      },
      betting: {
        over_under: String(bo.over_under ?? bo.over_under_runs ?? ""),
        line:       String(bo.moneyline ?? bo.lottery_handicap_home ?? bo.spread?.lottery_handicap_home ?? ""),
      },
      starters: {
        home: pitcherFromMatchup(pm.home_pitcher || pm.home_starter),
        away: pitcherFromMatchup(pm.away_pitcher || pm.away_starter),
      },
      team_stats: {
        home: {
          batting_avg:  stripRank(tbsHome.this_season?.avg),
          on_base_pct:  stripRank(tbsHome.this_season?.obp),
          avg_runs:     stripRank(tbsHome.this_season?.avg_runs),
          recent_form:  overallHome,
          home_record:  homeHomeRecord,
          last_10:      last10Home.last10,
          streak:       last10Home.streak,
        },
        away: {
          batting_avg:  stripRank(tbsAway.this_season?.avg),
          on_base_pct:  stripRank(tbsAway.this_season?.obp),
          avg_runs:     stripRank(tbsAway.this_season?.avg_runs),
          recent_form:  overallAway,
          away_record:  awayRoadRecord,
          last_10:      last10Away.last10,
          streak:       last10Away.streak,
        },
      },
      lineups: {
        home: data.expected_lineups?.[homeKey] || data.expected_lineups?.[elKeys.find(k => k.startsWith("home_"))] || [],
        away: data.expected_lineups?.[awayKey] || data.expected_lineups?.[elKeys.find(k => k.startsWith("away_"))] || [],
      },
    });
  }

  const gi = data.game_info || {};

  // ── Team name — may be a string OR an object {city, name, abbreviation} ──
  function extractTeamName(val) {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "object") return [val.city, val.name].filter(Boolean).join(" ") || val.abbreviation || "";
    return String(val);
  }
  const home_team = extractTeamName(gi.home_team || data.home_team);
  const away_team = extractTeamName(gi.away_team || data.away_team);

  // ── Weather — normalize wind/wind_speed key ──────────────────────────────
  const wRaw = data.weather || gi.weather || {};
  const weather = {
    condition:   wRaw.condition   || "",
    temperature: wRaw.temperature || "",
    wind_speed:  wRaw.wind_speed  || wRaw.wind || "",
  };

  // ── Betting — handle betting_lines / betting_odds / betting keys ──────────
  const bRaw = data.betting      || data.betting_lines || data.betting_odds ||
               gi.betting        || gi.betting_lines   || gi.betting_odds   || {};
  const ouRaw = String(bRaw.over_under || "").replace(/\s*runs?\s*/i, "").trim();
  const betting = {
    line:       bRaw.line || bRaw.run_line || "",
    over_under: ouRaw,
  };

  // ── Starters — handle home/away OR home_team/away_team keys ─────────────
  const spRaw = data.starters || data.starting_pitchers || gi.starters || gi.starting_pitchers || {};
  const spHome = spRaw.home || spRaw.home_team || {};
  const spAway = spRaw.away || spRaw.away_team || {};

  function flattenPitcher(p) {
    if (!p || typeof p !== "object") return {};
    const ss = p.season_stats || {};
    // Build win_loss string from numbers if not already a string
    const wl = p.win_loss || ss.win_loss ||
      (ss.wins != null && ss.losses != null ? `${ss.wins}-${ss.losses}` : "");
    return {
      name:                p.name || "",
      handedness:          p.handedness || "",
      era:                 String(p.era  != null ? p.era  : (ss.era  != null ? ss.era  : "")),
      whip:                String(p.whip != null ? p.whip : (ss.whip != null ? ss.whip : "")),
      win_loss:            wl,
      strikeouts:          String(p.strikeouts       != null ? p.strikeouts       : (ss.strikeouts       ?? "")),
      innings_pitched:     String(p.innings_pitched  != null ? p.innings_pitched  : (ss.innings_pitched  ?? "")),
      batting_avg_against: p.batting_avg_against || ss.batting_avg_against || ss.batting_average_against || "",
      walks:               String(p.walks != null ? p.walks : (ss.walks ?? "")),
      recent_games:        p.recent_games || p.recent_outings || [],
    };
  }
  const starters = {
    home: flattenPitcher(spHome),
    away: flattenPitcher(spAway),
  };

  // ── Team stats — handle home/away, home_team/away_team, dynamic keys ─────
  const tfRaw = data.team_stats || data.team_recent_form || gi.team_stats || gi.team_recent_form || {};
  let hStats = tfRaw.home || tfRaw.home_team || {};
  let aStats = tfRaw.away || tfRaw.away_team || {};
  // Fallback: dynamic keys like "home_marlins" / "away_orioles"
  if (!Object.keys(hStats).length && !Object.keys(aStats).length) {
    for (const [key, val] of Object.entries(tfRaw)) {
      if (key.toLowerCase().startsWith("home")) hStats = val;
      else if (key.toLowerCase().startsWith("away")) aStats = val;
    }
  }
  const team_stats = {
    home: {
      batting_avg: hStats.batting_avg  || hStats.batting_average  || "",
      on_base_pct: hStats.obp || hStats.on_base_pct || hStats.on_base_percentage || "",
      avg_runs:    hStats.avg_runs_scored || hStats.avg_runs || hStats.average_runs || "",
      recent_form: hStats.record_overall || hStats.record || hStats.recent_form || "",
      home_record: hStats.home_record    || hStats.record_home  || "",
      last_10:     hStats.last_10        || hStats.last_10_games || "",
      streak:      hStats.streak         || "",
    },
    away: {
      batting_avg: aStats.batting_avg  || aStats.batting_average  || "",
      on_base_pct: aStats.obp || aStats.on_base_pct || aStats.on_base_percentage || "",
      avg_runs:    aStats.avg_runs_scored || aStats.avg_runs || aStats.average_runs || "",
      recent_form: aStats.record_overall || aStats.record || aStats.recent_form || "",
      away_record: aStats.away_record    || aStats.record_away  || "",
      last_10:     aStats.last_10        || aStats.last_10_games || "",
      streak:      aStats.streak         || "",
    },
  };

  return {
    game_date:    gi.game_date || gi.date || data.game_date || "",
    game_time:    gi.game_time || gi.time || data.game_time || "",
    venue:        gi.venue     || data.venue || "",
    home_team,
    away_team,
    weather,
    betting,
    starters,
    team_stats,
    lineups:      data.lineups || data.expected_lineups || gi.lineups || {},
    data_sources: data.data_sources || gi.data_sources,
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
