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
    // ── ML Combos (931-game) ──────────────────────────────────────────────────
    MC1:  { label:"MC1",  type:"ml",   pct:"93%",  n:15,  title:"UNDER + Conf 50–55 + TMF",                    tip:"ML 93.3% n=15 · TOP combo — both ML and O/U (78.6%) elite here. Bet ML $75 + UNDER $75 full stake." },
    MC2:  { label:"MC2",  type:"ml",   pct:"93%",  n:14,  title:"Home pred + GVI<35 + Dome",                   tip:"ML 92.9% n=14 · suppressed scoring + dome neutrality. O/U unclear (42.9%) — skip O/U." },
    MC3:  { label:"MC3",  type:"ml",   pct:"92%",  n:13,  title:"Slumping SP + WP-Override A + UNDER",         tip:"ML 92.3% n=13 · double-confirmed SP quality gap. ML $75 + UNDER $37.50." },
    MC4:  { label:"MC4",  type:"ml",   pct:"90%",  n:19,  title:"Home pred + WP-Override A + UNDER",           tip:"ML 89.5% n=19 · largest 89%+ sample. O/U solid at 61.1%. ML $75 + UNDER $50." },
    MC5:  { label:"MC5",  type:"ml",   pct:"90%",  n:19,  title:"OU-A fired + WP-Override A + UNDER",          tip:"ML 89.5% n=19 · SP mismatch confirmed by two independent signals. UNDER $37.50 secondary." },
    MC6:  { label:"MC6",  type:"ml",   pct:"89%",  n:18,  title:"WP gap ≥20% + WP-Override A + UNDER",         tip:"ML 88.9% n=18 · large WP gap validates WPA signal. ML $75 only, skip O/U." },
    MC7:  { label:"MC7",  type:"ml",   pct:"87%",  n:15,  title:"Home pred + WP-Override A + Line 8–9",        tip:"ML 86.7% n=15 · AND 66.7% O/U — both markets strong. ML $75 + O/U direction $50." },
    MC8:  { label:"MC8",  type:"ml",   pct:"87%",  n:15,  title:"Home Fortress + WP-Override A + UNDER",       tip:"ML 86.7% n=15 · O/U 64.3%. ML $75 + UNDER $50." },
    MC9:  { label:"MC9",  type:"ml",   pct:"84%",  n:19,  title:"WP-Override A + RED mismatch + UNDER",        tip:"ML 84.2% n=19 · AND 66.7% O/U — best-balanced large-n combo. ML $75 + UNDER $50." },
    MC10: { label:"MC10", type:"ml",   pct:"86%",  n:14,  title:"Home pred + Heavy Favorite + UNDER",          tip:"ML 85.7% n=14 · AND 66.7% O/U. ML $75 + UNDER $50." },
    // ── O/U Combos (931-game) ────────────────────────────────────────────────
    OC1:  { label:"OC1",  type:"ou",   pct:"85%",  n:13,  title:"Conf 50–55 + GVI<35 + RCF",                   tip:"O/U 84.6% n=13 · ML weak (53.8%) — skip ML. O/U direction $75 only." },
    OC2:  { label:"OC2",  type:"ou",   pct:"84%",  n:25,  title:"Conf 50–55 + Dome + RCF",                     tip:"O/U 84.0% n=25 · AND 69.2% ML — best dual-market large-n combo. O/U $75 + ML $75." },
    OC3:  { label:"OC3",  type:"ou",   pct:"80%",  n:15,  title:"Heavy Favorite + Conf 50–55 + TMF",           tip:"O/U 80.0% n=15 · ML 62.5%. O/U $75 + ML $37.50." },
    OC4:  { label:"OC4",  type:"ou",   pct:"79%",  n:19,  title:"Heavy Favorite + Line 8–9 + TMF",             tip:"O/U 78.9% n=19 · ML poor (45.0%) — pure O/U play. Skip ML." },
    OC5:  { label:"OC5",  type:"ou",   pct:"79%",  n:14,  title:"Heavy Favorite + Dome + RCF",                 tip:"O/U 78.6% n=14 · ML 52.9% — coin flip, skip ML." },
    OC6:  { label:"OC6",  type:"ou",   pct:"78%",  n:18,  title:"Heavy Favorite + RED mismatch + TMF",         tip:"O/U 77.8% n=18 · ML weak (50.0%). O/U direction $75 only." },
    OC7:  { label:"OC7",  type:"ou",   pct:"77%",  n:13,  title:"Heavy Favorite + TMS home higher + Conf 50–55", tip:"O/U 76.9% n=13 · ML solid at 64.3%. O/U $75 + ML $50." },
    OC8:  { label:"OC8",  type:"ou",   pct:"77%",  n:17,  title:"WP gap ≥20% + UNDER + Conf 55–65",            tip:"O/U 76.5% n=17 · AND 70.6% ML — both markets above 70%. O/U $75 + ML $50." },
    OC9:  { label:"OC9",  type:"ou",   pct:"74%",  n:35,  title:"OU-B active + Conf 50–55 + TMF ★",            tip:"O/U 74.3% n=35★ largest sample · AND 71.1% ML — highest-confidence recurring bet. O/U $75 + ML $75." },
    OC10: { label:"OC10", type:"ou",   pct:"75%",  n:20,  title:"TMF + Dome + RCF",                            tip:"O/U 75.0% n=20 · ML weak (54.5%). O/U direction $75 only." },
    // ── Fade Signals (931-game) — all share away_surge (Away RED<-1.0) as the common ingredient ──
    FD1:  { label:"FD1",  type:"fade", pct:"89%",  n:18,  title:"OU-A fired + Surging Away SP",                tip:"STRONGEST fade in dataset (88.9%). Model backs HOME only 11.1% correct. Bet AWAY team ML $75. Skip O/U (38.9%)." },
    FD2:  { label:"FD2",  type:"fade", pct:"87%",  n:15,  title:"WP gap ≥20% + OU-B + Away surge",             tip:"87% fade (n=15). Model backs HOME on stale WP gap (13.3% correct). Bet AWAY $75. Skip O/U (40.0%)." },
    FD3:  { label:"FD3",  type:"fade", pct:"83%",  n:18,  title:"OU-B + RCF active + Away surge",              tip:"83% fade (n=18). Model backs HOME (16.7% correct). Bet AWAY $75. Skip O/U (44.4%)." },
    FD4:  { label:"FD4",  type:"fade", pct:"81%",  n:21,  title:"OU-A fired + RCF active + Away surge",        tip:"81% fade (n=21). Model backs HOME (19.0% correct) — repeatable at this sample size. Bet AWAY $75. Skip O/U (47.6%)." },
    FD5:  { label:"FD5",  type:"fade", pct:"76%",  n:41,  title:"RED mismatch>1.5 + OU-B + Away surge ★",      tip:"Largest sample fade (n=41★), highest-confidence. Model backs HOME (24.4% correct). Bet AWAY $75. Skip O/U (47.5%)." },
    FD6:  { label:"FD6",  type:"fade", pct:"77%",  n:31,  title:"Golden Condition + Away surge",               tip:"77% fade (n=31). Model backs HOME (22.6% correct). Bet AWAY $75. Skip O/U (41.9%)." },
    FD7:  { label:"FD7",  type:"fade", pct:"75%",  n:16,  title:"Home pred + OU-A fired + Away surge",         tip:"75% fade (n=16). Model backs HOME (25.0% correct). Bet AWAY $75. Skip O/U (31.2%)." },
    FD8:  { label:"FD8",  type:"fade", pct:"75%",  n:16,  title:"Home Fortress + OU-B + Away surge",           tip:"75% fade (n=16). Model backs HOME on fortress reputation (25.0% correct). Bet AWAY $75. Skip O/U (46.7%)." },
    FD9:  { label:"FD9",  type:"fade", pct:"76%",  n:29,  title:"OU-A fired + Line 8–9 + Away surge",          tip:"76% fade (n=29) · a reliable repeatable pattern. Model backs HOME (24.1% correct). Bet AWAY $75. Skip O/U (42.9%)." },
    FD10: { label:"FD10", type:"fade", pct:"77%",  n:13,  title:"Line 8–9 + RCF active + Away surge",          tip:"77% fade (n=13). Model backs HOME (23.1% correct). Bet AWAY $75. O/U borderline (61.5%) — optional small stake." }
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

  function parseArr(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v) { try { return JSON.parse(v); } catch(e) {} }
    return [];
  }
  const combos  = parseArr(data.combo_hits).filter(c => COMBO_META[c]);
  const fades   = parseArr(data.fade_signals).filter(c => COMBO_META[c]);
  const teams   = parseArr(data.team_signals).filter(t => TEAM_META[(t || "").split(":")[0]]);
  const all     = [...combos, ...fades, ...teams];

  if (all.length === 0) {
    if (block) block.style.display = "none";
    return;
  }
  if (block) block.style.display = "";

  const mlHits  = combos.filter(c => COMBO_META[c].type === "ml");
  const ouHits  = combos.filter(c => COMBO_META[c].type === "ou");
  const fdHits  = fades;

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

  let html = '<div class="combo-wrap">';

  if (fdHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label fade-label">⚠ Fade Signals Active — model direction may be reversed</div>`;
    html += `<div class="combo-chips">${chipHTML(fdHits, "rgba(226,75,74,.1)", "#e24b4a")}</div></div>`;
  }
  if (mlHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label ml-label">ML Combos</div>`;
    html += `<div class="combo-chips">${chipHTML(mlHits, "rgba(63,185,80,.1)", "#3fb950")}</div></div>`;
  }
  if (ouHits.length) {
    html += `<div class="combo-group"><div class="combo-group-label ou-label">O/U Combos</div>`;
    html += `<div class="combo-chips">${chipHTML(ouHits, "rgba(55,138,221,.1)", "#378ADD")}</div></div>`;
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
