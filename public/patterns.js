// patterns.js — Pattern Analysis Dashboard

let _charts = {};

document.addEventListener("DOMContentLoaded", () => {
  loadPatterns();
});

async function loadPatterns() {
  try {
    const [res, flagRes] = await Promise.all([
      fetch("/api/pattern-analysis"),
      fetch("/api/flag-stats"),
    ]);
    const data    = await res.json();
    const flagData = await flagRes.json();
    if (!res.ok) throw new Error(data.error);

    window._patternData = data;

    document.getElementById("loadingState").style.display  = "none";
    document.getElementById("patternsContent").style.display = "block";

    renderKPIs(data);
    renderCharts(data);
    renderPatternCards(computePatterns(data));
    renderPatternIndex(flagData.data || []);
    renderRuleIndex(flagData.data || []);
  } catch (err) {
    document.getElementById("loadingState").innerHTML =
      `<div style="color:var(--red);font-size:1rem">Failed to load: ${esc(err.message)}</div>`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(wins, total) { return total > 0 ? +(wins / total * 100).toFixed(1) : 0; }

function barColor(v) {
  return v >= 58 ? '#22c55e' : v >= 50 ? '#f5c518' : '#ef4444';
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function chartDefaults() {
  const light = document.body.classList.contains('light');
  return {
    textColor: light ? '#4a4f68' : '#8a8fa8',
    gridColor: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
  };
}

function destroyChart(key) {
  if (_charts[key]) { _charts[key].destroy(); delete _charts[key]; }
}

// ─── KPI Row ──────────────────────────────────────────────────────────────────
function renderKPIs(data) {
  const { overall } = data;
  const mlAcc  = pct(overall.ml_wins,  overall.graded);
  const ouAcc  = pct(overall.ou_wins,  overall.ou_graded);
  const mlColor = overall.graded  === 0 ? "" : mlAcc >= 58 ? "var(--green)" : mlAcc >= 50 ? "var(--gold)" : "var(--red)";
  const ouColor = overall.ou_graded === 0 ? "" : ouAcc >= 55 ? "var(--green)" : ouAcc >= 48 ? "var(--gold)" : "var(--red)";

  const over  = (data.byDirection||[]).find(d => d.ou_prediction === 'OVER')  || {total:0,ou_wins:0};
  const under = (data.byDirection||[]).find(d => d.ou_prediction === 'UNDER') || {total:0,ou_wins:0};
  const overAcc  = pct(over.ou_wins,  over.total);
  const underAcc = pct(under.ou_wins, under.total);

  const last10 = (data.trend||[]).slice(-10);
  const l10ml  = last10.length ? pct(last10.filter(g => g.ml_correct===1).length, last10.length) : null;
  const l10color = l10ml == null ? "" : l10ml >= 58 ? "var(--green)" : l10ml >= 50 ? "var(--gold)" : "var(--red)";

  const pending = overall.total - overall.graded;

  document.getElementById("kpiRow").innerHTML = `
    <div class="pa-kpi-card">
      <div class="pa-kpi-label">Total Predictions</div>
      <div class="pa-kpi-val">${overall.total}</div>
      <div class="pa-kpi-sub">${overall.graded} graded · ${pending} pending</div>
    </div>
    <div class="pa-kpi-card">
      <div class="pa-kpi-label">ML Accuracy</div>
      <div class="pa-kpi-val" style="color:${mlColor}">${overall.graded ? mlAcc + "%" : "—"}</div>
      <div class="pa-kpi-sub">${overall.ml_wins}W · ${overall.graded - overall.ml_wins}L of ${overall.graded}</div>
    </div>
    <div class="pa-kpi-card">
      <div class="pa-kpi-label">O/U Accuracy</div>
      <div class="pa-kpi-val" style="color:${ouColor}">${overall.ou_graded ? ouAcc + "%" : "—"}</div>
      <div class="pa-kpi-sub">${overall.ou_wins}W · ${overall.ou_graded - overall.ou_wins}L of ${overall.ou_graded}</div>
    </div>
    <div class="pa-kpi-card">
      <div class="pa-kpi-label">OVER Hit Rate</div>
      <div class="pa-kpi-val" style="color:${barColor(overAcc)}">${over.total ? overAcc + "%" : "—"}</div>
      <div class="pa-kpi-sub">${over.ou_wins}W / ${over.total} bets</div>
    </div>
    <div class="pa-kpi-card">
      <div class="pa-kpi-label">UNDER Hit Rate</div>
      <div class="pa-kpi-val" style="color:${barColor(underAcc)}">${under.total ? underAcc + "%" : "—"}</div>
      <div class="pa-kpi-sub">${under.ou_wins}W / ${under.total} bets</div>
    </div>
    <div class="pa-kpi-card">
      <div class="pa-kpi-label">Last 10 ML</div>
      <div class="pa-kpi-val" style="color:${l10color}">${l10ml != null ? l10ml + "%" : "—"}</div>
      <div class="pa-kpi-sub">${last10.filter(g=>g.ml_correct===1).length}W · ${last10.filter(g=>g.ml_correct===0).length}L recent</div>
    </div>`;
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function renderCharts(data) {
  const d = chartDefaults();
  Chart.defaults.color       = d.textColor;
  Chart.defaults.borderColor = d.gridColor;
  Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
  Chart.defaults.font.size   = 11;

  // Section 1 — Pies
  chartMLPie(data, d);
  chartDirPie(data.byDirection, d);
  chartOUPie(data, d);
  // Section 2 — Core
  chartConfidence(data.byConfidence, d);
  chartWP(data.byWP, d);
  chartTrend(data.trend, d);
  chartOUTier(data.byOUTier, d);
  chartHomeAway(data.homeAway, d);
  // Section 3 — O/U lines
  chartGranularLine(data.byGranularLine || [], d);
  chartLineRange(data.byLineRange, d);
  chartTotalDist(data.totalDist, d);
  // Section 4 — Context
  chartGVI(data.byGVI || [], d);
  chartHandedness(data.byHandedness || [], d);
  chartMonthly(data.byMonth, d);
}

function chartConfidence(data, d) {
  const ORDER = ['Below 50','50–54','55–59','60–64','65–69','70+'];
  const rows   = ORDER.map(b => data.find(r => r.bucket === b) || {bucket:b,total:0,ml_wins:0});
  const labels = rows.map(r => r.bucket);
  const vals   = rows.map(r => pct(r.ml_wins, r.total));
  const counts = rows.map(r => r.total);

  destroyChart('conf');
  _charts.conf = new Chart(document.getElementById('chartConf'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'ML Hit Rate', data: vals, backgroundColor: vals.map(barColor), borderRadius: 6, barThickness: 32 }] },
    options: baseBarOpts(d, counts, '%', 0, 100),
  });
}

function chartLineRange(data, d) {
  const RANGES = ['<7.0','7.0–7.9','8.0–8.9','9.0–9.9','10.0+'];
  const labels=[], overVals=[], underVals=[], oc=[], uc=[];
  RANGES.forEach(r => {
    const ov = data.find(x => x.line_range===r && x.ou_prediction==='OVER');
    const un = data.find(x => x.line_range===r && x.ou_prediction==='UNDER');
    if (!ov && !un) return;
    labels.push(r);
    overVals.push(ov ? pct(ov.ou_wins, ov.total) : null);
    underVals.push(un ? pct(un.ou_wins, un.total) : null);
    oc.push(ov ? ov.total : 0);
    uc.push(un ? un.total : 0);
  });

  destroyChart('line');
  _charts.line = new Chart(document.getElementById('chartLine'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'OVER %',  data: overVals,  backgroundColor: 'rgba(224,92,58,0.72)',  borderColor: '#e05c3a', borderWidth:1, borderRadius:5 },
        { label: 'UNDER %', data: underVals, backgroundColor: 'rgba(58,143,224,0.72)', borderColor: '#3a8fe0', borderWidth:1, borderRadius:5 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y+'%' : 'N/A'} (n=${ctx.datasetIndex===0?oc[ctx.dataIndex]:uc[ctx.dataIndex]})` } }
      },
      scales: {
        y: { min:0, max:100, ticks:{ callback: v=>v+'%' }, grid:{ color:d.gridColor } },
        x: { grid:{ display:false } }
      }
    }
  });
}

function chartWP(data, d) {
  const ORDER  = ['50–54%','55–59%','60–64%','65–69%','≥70%'];
  const rows   = ORDER.map(b => data.find(r => r.wp_bucket===b) || {wp_bucket:b,total:0,ml_wins:0});
  const labels = rows.map(r => r.wp_bucket);
  const vals   = rows.map(r => pct(r.ml_wins, r.total));
  const counts = rows.map(r => r.total);

  destroyChart('wp');
  _charts.wp = new Chart(document.getElementById('chartWP'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'ML Hit Rate', data: vals, backgroundColor: vals.map(barColor), borderRadius: 6, barThickness: 34 }] },
    options: baseBarOpts(d, counts, '%', 0, 100),
  });
}

function chartDirection(data, d) {
  const over  = data.find(r => r.ou_prediction==='OVER')  || {total:0,ou_wins:0};
  const under = data.find(r => r.ou_prediction==='UNDER') || {total:0,ou_wins:0};

  destroyChart('dir');
  _charts.dir = new Chart(document.getElementById('chartDir'), {
    type: 'doughnut',
    data: {
      labels: [`OVER — ${pct(over.ou_wins,over.total)}% acc`, `UNDER — ${pct(under.ou_wins,under.total)}% acc`],
      datasets: [{
        data: [over.total, under.total],
        backgroundColor: ['rgba(224,92,58,0.78)', 'rgba(58,143,224,0.78)'],
        borderColor: ['#e05c3a', '#3a8fe0'],
        borderWidth: 2,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position:'bottom', labels:{ padding:16, boxWidth:14, font:{size:11} } },
        tooltip: { callbacks: { label: ctx => {
          const item = ctx.dataIndex===0 ? over : under;
          return ` ${item.ou_wins}W / ${item.total} bets (${pct(item.ou_wins,item.total)}% hit)`;
        }}}
      }
    }
  });
}

function chartTrend(trend, d) {
  if (trend.length < 5) return;
  const W = Math.min(10, Math.floor(trend.length / 2));
  const points=[], breakeven=[];
  for (let i = W-1; i < trend.length; i++) {
    const slice = trend.slice(i-W+1, i+1);
    points.push(+(slice.filter(g=>g.ml_correct===1).length/W*100).toFixed(1));
    breakeven.push(52.4);
  }
  const labels = points.map((_,i) => `G${i+W}`);

  destroyChart('trend');
  _charts.trend = new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `${W}-Game Rolling ML %`,
          data: points,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.07)',
          tension: 0.35,
          fill: true,
          pointRadius: 2.5,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
        {
          label: 'Breakeven 52.4%',
          data: breakeven,
          borderColor: '#f5c518',
          borderDash: [6,4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels:{ boxWidth:12, padding:14 } } },
      scales: {
        y: { min:0, max:100, ticks:{ callback: v=>v+'%' }, grid:{ color:d.gridColor } },
        x: { grid:{ display:false }, ticks:{ maxTicksLimit:10, font:{size:10} } }
      }
    }
  });
}

function chartOUTier(data, d) {
  const ORDER = ['Low','Moderate','High'];
  const rows  = ORDER.map(t => data.find(r => r.ou_confidence===t) || {ou_confidence:t,total:0,ou_wins:0});
  const vals   = rows.map(r => pct(r.ou_wins, r.total));
  const counts = rows.map(r => r.total);

  destroyChart('outier');
  _charts.outier = new Chart(document.getElementById('chartOUTier'), {
    type: 'bar',
    data: {
      labels: ORDER,
      datasets: [{
        label: 'O/U Hit Rate',
        data: vals,
        backgroundColor: ['rgba(58,143,224,0.7)','rgba(245,197,24,0.7)','rgba(34,197,94,0.7)'],
        borderColor: ['#3a8fe0','#f5c518','#22c55e'],
        borderWidth: 1.5,
        borderRadius: 7,
        barThickness: 44,
      }]
    },
    options: baseBarOpts(d, counts, '%', 0, 100),
  });
}

function chartTotalDist(data, d) {
  destroyChart('totaldist');
  _charts.totaldist = new Chart(document.getElementById('chartTotalDist'), {
    type: 'bar',
    data: {
      labels: data.map(r => r.range),
      datasets: [{
        label: 'Games',
        data: data.map(r => r.cnt),
        backgroundColor: 'rgba(200,16,46,0.45)',
        borderColor: '#c8102e',
        borderWidth: 1.5,
        borderRadius: 5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} game${ctx.parsed.y!==1?'s':''}` } }
      },
      scales: {
        y: { beginAtZero:true, ticks:{ stepSize:1 }, grid:{ color:d.gridColor } },
        x: { grid:{ display:false } }
      }
    }
  });
}

function chartMonthly(data, d) {
  const mlVals  = data.map(r => pct(r.ml_wins,  r.total));
  const ouVals  = data.map(r => pct(r.ou_wins,  r.ou_graded));
  const mlCounts= data.map(r => r.total);
  const ouCounts= data.map(r => r.ou_graded);

  destroyChart('monthly');
  _charts.monthly = new Chart(document.getElementById('chartMonthly'), {
    type: 'bar',
    data: {
      labels: data.map(r => r.month),
      datasets: [
        { label:'ML %',  data:mlVals, backgroundColor:'rgba(34,197,94,0.60)',  borderColor:'#22c55e', borderWidth:1, borderRadius:5 },
        { label:'O/U %', data:ouVals, backgroundColor:'rgba(26,111,196,0.60)', borderColor:'#1a6fc4', borderWidth:1, borderRadius:5 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels:{ boxWidth:12 } },
        tooltip: { callbacks: { label: ctx => {
          const n = ctx.datasetIndex===0 ? mlCounts[ctx.dataIndex] : ouCounts[ctx.dataIndex];
          return ` ${ctx.dataset.label}: ${ctx.parsed.y}% (n=${n})`;
        }}}
      },
      scales: {
        y: { min:0, max:100, ticks:{ callback:v=>v+'%' }, grid:{ color:d.gridColor } },
        x: { grid:{ display:false } }
      }
    }
  });
}

function chartHomeAway(data, d) {
  const home = data.find(r=>r.pick==='Home') || {total:0,wins:0};
  const away = data.find(r=>r.pick==='Away') || {total:0,wins:0};
  const hp   = pct(home.wins, home.total);
  const ap   = pct(away.wins, away.total);

  destroyChart('homeaway');
  _charts.homeaway = new Chart(document.getElementById('chartHomeAway'), {
    type: 'bar',
    data: {
      labels: ['Home Picks','Away Picks'],
      datasets: [{
        label: 'ML Hit Rate',
        data: [hp, ap],
        backgroundColor: [barColor(hp), barColor(ap)],
        borderRadius: 8,
        barThickness: 56,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: ctx => {
          const item = ctx.dataIndex===0 ? home : away;
          return ` ${ctx.parsed.x}% (${item.wins}W / ${item.total} games)`;
        }}}
      },
      scales: {
        x: { min:0, max:100, ticks:{ callback:v=>v+'%' }, grid:{ color:d.gridColor } },
        y: { grid:{ display:false } }
      }
    }
  });
}

// ─── New pie charts ───────────────────────────────────────────────────────────
function pieDefaults() {
  return { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, padding:14 } } } };
}

function chartMLPie(data, d) {
  const { overall } = data;
  const wins = overall.ml_wins || 0;
  const losses = (overall.graded || 0) - wins;
  const pending = (overall.total || 0) - (overall.graded || 0);
  destroyChart('mlpie');
  _charts.mlpie = new Chart(document.getElementById('chartMLPie'), {
    type: 'doughnut',
    data: {
      labels: [`Win (${wins})`, `Loss (${losses})`, `Pending (${pending})`],
      datasets: [{ data:[wins, losses, pending], backgroundColor:['rgba(34,197,94,0.75)','rgba(239,68,68,0.75)','rgba(138,143,168,0.35)'], borderWidth:2, hoverOffset:6 }]
    },
    options: { ...pieDefaults(), cutout:'62%' }
  });
}

function chartDirPie(data, d) {
  const over  = data.find(r=>r.ou_prediction==='OVER')  || {total:0,ou_wins:0};
  const under = data.find(r=>r.ou_prediction==='UNDER') || {total:0,ou_wins:0};
  const overAcc  = pct(over.ou_wins, over.total);
  const underAcc = pct(under.ou_wins, under.total);
  destroyChart('dirpie');
  _charts.dirpie = new Chart(document.getElementById('chartDirPie'), {
    type: 'doughnut',
    data: {
      labels: [`OVER — ${overAcc}% acc (${over.total})`, `UNDER — ${underAcc}% acc (${under.total})`],
      datasets: [{ data:[over.total, under.total], backgroundColor:['rgba(224,92,58,0.75)','rgba(58,143,224,0.75)'], borderWidth:2, hoverOffset:6 }]
    },
    options: { ...pieDefaults(), cutout:'62%' }
  });
}

function chartOUPie(data, d) {
  const wins = data.overall.ou_wins || 0;
  const losses = (data.overall.ou_graded || 0) - wins;
  const pending = (data.overall.total || 0) - (data.overall.ou_graded || 0);
  destroyChart('oupie');
  _charts.oupie = new Chart(document.getElementById('chartOUPie'), {
    type: 'doughnut',
    data: {
      labels: [`Win (${wins})`, `Loss (${losses})`, `Pending (${pending})`],
      datasets: [{ data:[wins, losses, pending], backgroundColor:['rgba(99,102,241,0.75)','rgba(239,68,68,0.75)','rgba(138,143,168,0.35)'], borderWidth:2, hoverOffset:6 }]
    },
    options: { ...pieDefaults(), cutout:'62%' }
  });
}

// ─── Granular line chart (0.5 increments) ─────────────────────────────────────
function chartGranularLine(data, d) {
  const BUCKETS = ['7.0','7.5','8.0','8.5','9.0','9.5','10.0+'];
  const labels=[], overVals=[], underVals=[], oc=[], uc=[];
  BUCKETS.forEach(b => {
    const ov = data.find(x=>x.line_bucket===b && x.ou_prediction==='OVER');
    const un = data.find(x=>x.line_bucket===b && x.ou_prediction==='UNDER');
    if (!ov && !un) return;
    labels.push(b);
    overVals.push(ov ? pct(ov.ou_wins, ov.total) : null);
    underVals.push(un ? pct(un.ou_wins, un.total) : null);
    oc.push(ov ? ov.total : 0);
    uc.push(un ? un.total : 0);
  });
  destroyChart('granline');
  _charts.granline = new Chart(document.getElementById('chartGranularLine'), {
    type:'bar',
    data:{ labels, datasets:[
      { label:'OVER %',  data:overVals,  backgroundColor:'rgba(224,92,58,0.70)',  borderColor:'#e05c3a', borderWidth:1, borderRadius:5 },
      { label:'UNDER %', data:underVals, backgroundColor:'rgba(58,143,224,0.70)', borderColor:'#3a8fe0', borderWidth:1, borderRadius:5 },
      { type:'line', label:'Breakeven', data:labels.map(()=>52.4), borderColor:'rgba(245,197,24,0.6)', borderDash:[4,4], borderWidth:1.5, pointRadius:0, fill:false },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ tooltip:{ callbacks:{ label: ctx => ctx.dataset.label==='Breakeven' ? null : ` ${ctx.dataset.label}: ${ctx.parsed.y??'N/A'}% (n=${ctx.datasetIndex===0?oc[ctx.dataIndex]:uc[ctx.dataIndex]})` } }, legend:{ labels:{ boxWidth:12 } } },
      scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+'%' }, grid:{ color:d.gridColor } }, x:{ grid:{ display:false } } }
    }
  });
}

// ─── GVI range chart ──────────────────────────────────────────────────────────
function chartGVI(data, d) {
  const ORDER = ['<35 (Low)','35–49','50–64','65–79','80+ (High)'];
  const rows = ORDER.map(b => data.find(r=>r.gvi_bucket===b) || {gvi_bucket:b,total:0,ml_wins:0,ou_graded:0,ou_wins:0});
  const labels  = rows.map(r=>r.gvi_bucket);
  const mlVals  = rows.map(r=>pct(r.ml_wins, r.total));
  const ouVals  = rows.map(r=>pct(r.ou_wins, r.ou_graded));
  const counts  = rows.map(r=>r.total);
  destroyChart('gvi');
  _charts.gvi = new Chart(document.getElementById('chartGVI'), {
    type:'bar',
    data:{ labels, datasets:[
      { label:'ML %',  data:mlVals, backgroundColor:'rgba(34,197,94,0.60)',  borderColor:'#22c55e', borderWidth:1, borderRadius:5 },
      { label:'O/U %', data:ouVals, backgroundColor:'rgba(99,102,241,0.60)', borderColor:'#6366f1', borderWidth:1, borderRadius:5 },
      { type:'line', label:'Breakeven', data:labels.map(()=>52.4), borderColor:'rgba(245,197,24,0.6)', borderDash:[4,4], borderWidth:1.5, pointRadius:0, fill:false },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ boxWidth:12 } }, tooltip:{ callbacks:{ label: ctx => ctx.dataset.label==='Breakeven' ? null : ` ${ctx.dataset.label}: ${ctx.parsed.y}% (n=${counts[ctx.dataIndex]})` } } },
      scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+'%' }, grid:{ color:d.gridColor } }, x:{ grid:{ display:false } } }
    }
  });
}

// ─── Handedness matchup chart ─────────────────────────────────────────────────
function chartHandedness(data, d) {
  const ORDER = ['Both LHP','Both RHP','Away LHP vs Home RHP','Away RHP vs Home LHP'];
  const LABELS = ['Both LHP','Both RHP','Away LHP / Home RHP','Away RHP / Home LHP'];
  const rows = ORDER.map((k,i) => ({ ...( data.find(r=>r.matchup===k) || {total:0,ml_wins:0,ou_graded:0,ou_wins:0} ), label:LABELS[i] }));
  const labels  = rows.map(r=>r.label);
  const mlVals  = rows.map(r=>pct(r.ml_wins, r.total));
  const ouVals  = rows.map(r=>pct(r.ou_wins, r.ou_graded));
  const counts  = rows.map(r=>r.total);
  destroyChart('hand');
  _charts.hand = new Chart(document.getElementById('chartHandedness'), {
    type:'bar',
    data:{ labels, datasets:[
      { label:'ML %',  data:mlVals, backgroundColor:'rgba(34,197,94,0.60)',  borderColor:'#22c55e', borderWidth:1, borderRadius:5 },
      { label:'O/U %', data:ouVals, backgroundColor:'rgba(99,102,241,0.60)', borderColor:'#6366f1', borderWidth:1, borderRadius:5 },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ boxWidth:12 } }, tooltip:{ callbacks:{ label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}% (n=${counts[ctx.dataIndex]})` } } },
      scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+'%' }, grid:{ color:d.gridColor } }, x:{ grid:{ display:false } } }
    }
  });
}

// ─── Pattern Index Table (P1–P26) ─────────────────────────────────────────────
const PATTERN_DEFS = [
  { code:'P1',  label:'Dome + Dual Elite SP',             type:'Under', expOU:67, expML:null, desc:'Indoor/dome stadium AND both SPs xFIP≤3.25 or ERA≤2.80 AND 4+ starts + ≥20 IP', rule:'Pattern A Under $150 · All 7 gates required' },
  { code:'P2',  label:'Home Ace vs ATH/WAS (April)',      type:'Under', expOU:67, expML:null, desc:'Home SP ERA<2.50 + 4+ starts + ≥20 IP AND visitor is Oakland or Washington', rule:'Pattern B Under $75 · April only, specific visitors only' },
  { code:'P3',  label:'Cold Natural Grass [SUSPENDED]',   type:'Under', expOU:33, expML:null, desc:'Temp<45°F + natural grass + no wind OUT — SUSPENDED (33% hit rate)', rule:'Suspended until May retest · Do not use' },
  { code:'P4',  label:'Road Ace VETO',                    type:'VETO',  expOU:null, expML:null, desc:'Away SP xFIP≤3.25 on road → UNDER banned. ML still eligible', rule:'Dual-ace exception routes to P1/P2 instead' },
  { code:'P5',  label:'Confidence Zone 50–64',            type:'Zone',  expOU:56.6, expML:null, desc:'Valid O/U betting zone is conf 50–64 only. Below 50 = too uncertain. Above 65 = P9_BAN', rule:'Only place O/U bets when conf in this range' },
  { code:'P6',  label:'ML Bet in Zone (WP≥60%)',          type:'ML',    expOU:null, expML:62.7, desc:'WP≥70% = 85.7% · WP≥65% = 68.8% · WP≥60% = 62.7% · Conf 65-69 = 66.7%', rule:'ML bet $75 when WP≥60% or conf 50–54 or 65–69' },
  { code:'P7',  label:'Hot Batting Team HARD SKIP',       type:'Skip',  expOU:14, expML:null, desc:'Either team avg_runs≥5.0 AND 3+ win streak → HARD SKIP (14% hit rate, -38.7% ROI)', rule:'Do not auto-bet. Requires user confirmation' },
  { code:'P8',  label:'Venue Under Ban',                  type:'BAN',   expOU:null, expML:null, desc:'Target/Progressive Field cold, NYY home April, or PIT home → permanently banned', rule:'0–22% hit rate in qualifying games' },
  { code:'P9',  label:'High Confidence Cap (O/U)',        type:'Cap',   expOU:25, expML:null, desc:'O/U confidence ≥65 → cap to 64 for betting (25% hit rate at 65+). ML at 65–69 still eligible', rule:'P9 applies to O/U bets ONLY' },
  { code:'P10', label:'Projected Total ≤6.5',             type:'Under', expOU:74, expML:null, desc:'Corrected projected total ≤6.5 → Strong UNDER signal. Gap threshold drops to 1.5 runs', rule:'Strong Under · Stake capped at $50 · 74% hit rate (n=23)' },
  { code:'P11', label:'LAD Home Ace (Ohtani/Yamamoto/Sasaki)', type:'Under', expOU:80, expML:null, desc:'Dodger Stadium + named ace + Gate C → Pattern C Under $100', rule:'Pattern C Under $100 · 80% hit rate (n=5)' },
  { code:'P12', label:'OVER Line 9.0–10.0',               type:'OVER',  expOU:65.2, expML:null, desc:'Line 9–10 OVER + ≥1 signal → elite zone. Cancel if both SPs xFIP≤3.00', rule:'Pattern D OVER $75 · Strongest mass-sample bet (n=32)' },
  { code:'P13', label:'OVER Line 10.0–12.0',              type:'OVER',  expOU:80, expML:null, desc:'High-line OVER with Moderate confidence + primary signal. Small sample n=5', rule:'Pattern E OVER $50 · Small sample — supporting signal only' },
  { code:'P14', label:'OVER Line 7.0–8.0',                type:'OVER',  expOU:61.5, expML:null, desc:'Low-line fade-the-book OVER. Requires ≥1 catalyst (wind, slumping SP, hot offence)', rule:'Pattern F OVER $50 · UNDER at 7–8 = 29.2% (banned)' },
  { code:'P15', label:'UNDER Line 8.0–9.0 Sweet Spot',    type:'Under', expOU:57.5, expML:null, desc:'Only UNDER line range above breakeven. All 7 gates required. Moderate confidence only', rule:'UNDER sweet spot · Never High confidence for UNDER' },
  { code:'P16', label:'Home WP ≥70% ML',                  type:'ML',    expOU:null, expML:85.7, desc:'Home WP≥70% → ML home unconditional. Highest ML signal. Do not use O/U in same games', rule:'Bet unconditionally · 85.7% hit rate (n=7)' },
  { code:'P17', label:'Home WP 65–69% ML',                type:'ML',    expOU:null, expML:68.8, desc:'Home WP 65–69% → ML home as primary. Strong structural advantage', rule:'Bet as primary · 68.8% hit rate (n=16)' },
  { code:'P18', label:'WAS Home OVER',                    type:'OVER',  expOU:100, expML:null, desc:'Nationals Park home → Pattern G OVER $75. Avg 12.2 runs, 100% hit rate (n=4)', rule:'Pattern G OVER $75 · Always OVER bias at WAS home' },
  { code:'P19', label:'PIT Home O/U Ban',                 type:'BAN',   expOU:0, expML:null, desc:'PNC Park any O/U → permanently banned (0/4 games). Wind creates totals of 2–21', rule:'ML PIT home only · O/U is completely banned' },
  { code:'P20', label:'Dome OVER',                        type:'OVER',  expOU:67, expML:null, desc:'Dome stadium + OVER signal → valid. Dome removes all weather suppression noise', rule:'67% hit rate (n=9) · Valid in any dome' },
  { code:'P21', label:'Dome UNDER Ban',                   type:'BAN',   expOU:37, expML:null, desc:'Dome + UNDER without dual confirmed ace → banned (37% hit rate). No weather floor to support', rule:'Exception: both SPs ≥4 starts + ERA<2.50 → route to P1' },
  { code:'P22', label:'Both LHP → UNDER',                 type:'Under', expOU:80, expML:null, desc:'Both SPs left-handed + UNDER direction → 80% hit rate (n=5). Genuine scoring suppression', rule:'Always weight UNDER 80:20 when both LHP' },
  { code:'P23', label:'Both LHP → OVER Ban',              type:'BAN',   expOU:50, expML:null, desc:'Both SPs LHP + OVER → banned (50% coin flip). LHP suppression neutralises OVER signal', rule:'Route to UNDER or Pass when both LHP + OVER' },
  { code:'P24', label:'Named Ace Home UNDER',             type:'Under', expOU:100, expML:null, desc:'Ohtani/Yamamoto/Sale/Castillo/Woo/Kirby/Skubal/Fried + Gate C → Pattern H Under $75', rule:'Pattern H Under $75 · 100% hit rate (n=10)' },
  { code:'P25', label:'HOU Home OVER',                    type:'OVER',  expOU:75, expML:null, desc:'Minute Maid Park home → OVER bias. Avg 12.1 runs, ~75% hit rate (n=8)', rule:'Strong OVER bias at HOU home' },
  { code:'P26', label:'Inversion Day Detection',          type:'ML',    expOU:null, expML:null, desc:'Prev-day ML<40% + O/U>70% → reduce ML to $37.50, concentrate O/U at full unit', rule:'Shift staking to totals on inversion days' },
];

const RULE_DEFS = [
  { code:'R1',  label:'No O/U Signal',           expOU:16.3, expML:null,  note:'Hard stop — no direction output when zero signal flags active. Applies in all months including April.' },
  { code:'R2',  label:'Line 9–10 OVER + Signal', expOU:68.8, expML:null,  note:'Strongest mass-sample bet. Requires ≥1 active signal. Cancel if both SPs xFIP≤3.00.' },
  { code:'R3',  label:'Single Signal → ML only', expOU:37.5, expML:75.0,  note:'One signal = ML 75% (bet ML). Skip O/U (37.5%). Signal implies directional clarity, not scoring certainty.' },
  { code:'R4',  label:'WP-Override A',            expOU:null, expML:63.0,  note:'Surging ace vs slumping opponent → bet ML. O/U UNDER requires confirmed xFIP (not estimated).' },
  { code:'R5',  label:'PVS>15 [REVERSED v3.5]',  expOU:38.0, expML:null,  note:'Removed as OVER signal — 38–40% staked actual. Now confidence suppressor only (−10/pitcher).' },
  { code:'R6',  label:'UNDER Line 8.0–9.0',      expOU:60.5, expML:null,  note:'Only viable UNDER window. Below 8.0 = 34.5% (banned). Above 9.0 = sub-40% (banned).' },
  { code:'R7',  label:'GVI≥65 OVER only',        expOU:58.9, expML:50.0,  note:'O/U OVER 58.9%. ML = 50% coin flip (skip). UNDER = 0.0% hard ban.' },
  { code:'R8',  label:'MCF → ML BAN',            expOU:45.8, expML:50.0,  note:'MCF = ML prohibited (50% coin flip). O/U eligible if signal present. Prior 25% reduction was insufficient.' },
  { code:'R9',  label:'Wind OUT Sizing',          expOU:54.0, expML:null,  note:'Standalone = OVER $25 lean (54–56%). With catalyst = OVER $50 standard.' },
  { code:'R10', label:'Conf 60–64 [RETIRED]',    expOU:63.6, expML:null,  note:'Retired v3.5. Superseded by R12 extension. Conf 60–64 is now inside the dead zone.' },
  { code:'R11', label:'Slumping SP',             expOU:62.0, expML:null,  note:'Either SP RED>+1.5 → O/U power signal +20pp. Independently justifies O/U bet.' },
  { code:'R12', label:'Conf 55–65 Dead Zone',    expOU:28.0, expML:null,  note:'Extended from 55–60 to 55–65 (v3.5). Output PASS — no O/U direction. ML still eligible.' },
  { code:'R13', label:'Platoon Weakness Flag',   expOU:null, expML:86.0,  note:'Batting team 0-for-3+ vs SP handedness → ML 86%. Highest alpha signal. Apply +8% WP.' },
  { code:'R14', label:'Away Ace Override',       expOU:null, expML:100.0, note:'Away SP RED<−1.0 while model backs home → 9/9 failure. Apply −10% home WP, flip ML away.' },
];

function renderIndexTable(containerId, defs, flagData, keyField, expMLField, expOUField) {
  const byCode = {};
  (flagData || []).forEach(f => { byCode[f.code] = f; });

  const chip = (actual, expected) => {
    if (actual === null || actual === undefined) return `<span class="pi-chip pi-chip--dim">—</span>`;
    const diff = expected != null ? actual - expected : null;
    const cls = diff === null ? 'pi-chip--blue' : diff >= 5 ? 'pi-chip--green' : diff >= -3 ? 'pi-chip--yellow' : 'pi-chip--red';
    const arrow = diff === null ? '' : diff >= 5 ? ' ↑' : diff <= -3 ? ' ↓' : '';
    return `<span class="pi-chip ${cls}">${actual}%${arrow}</span>`;
  };

  const typeBadge = (type) => {
    const map = { Under:'pi-badge--blue', OVER:'pi-badge--orange', ML:'pi-badge--green', BAN:'pi-badge--red', VETO:'pi-badge--red', Cap:'pi-badge--yellow', Zone:'pi-badge--purple', Skip:'pi-badge--yellow' };
    return `<span class="pi-badge ${map[type]||'pi-badge--gray'}">${type}</span>`;
  };

  const rows = defs.map(def => {
    const f = byCode[def.codeKey || def.code] || {};
    const mlAct  = f.ml_accuracy ?? null;
    const ouAct  = f.ou_accuracy ?? null;
    const trig   = f.triggered   ?? 0;
    return `
      <tr>
        <td class="pi-code">${def.code}</td>
        <td>${typeBadge(def.type)}</td>
        <td class="pi-label">${def.label}</td>
        <td class="pi-desc">${def.desc}</td>
        <td class="pi-center">${trig > 0 ? trig : '<span class="pi-dim">—</span>'}</td>
        <td class="pi-center">${chip(mlAct, def.expML)}${def.expML!=null?`<span class="pi-exp">exp ${def.expML}%</span>`:''}</td>
        <td class="pi-center">${chip(ouAct, def.expOU)}${def.expOU!=null?`<span class="pi-exp">exp ${def.expOU}%</span>`:''}</td>
        <td class="pi-note">${def.note || def.rule || ''}</td>
      </tr>`;
  }).join('');

  document.getElementById(containerId).innerHTML = `
    <div class="pi-wrap">
      <table class="pi-table">
        <thead><tr>
          <th>Code</th><th>Type</th><th>Pattern / Rule</th><th>Description</th>
          <th class="pi-center">Triggered</th>
          <th class="pi-center">ML% actual vs exp</th>
          <th class="pi-center">O/U% actual vs exp</th>
          <th>Framework Note</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderPatternIndex(flagData) {
  // Map P-codes to flag codes used in FLAG_DEFS
  const CODE_MAP = {
    P1:'P1_MATCH', P2:'P2_MATCH', P3:'P3_SUSPENDED', P4:'P4_ROAD_ACE', P7:'P7_SKIP',
    P8:'P8_BAN', P10:'P10_MATCH', P11:'P11_LAD_ACE', P12:'P12_OVER_SWEET', P13:'P13_OVER_HIGH',
    P14:'P14_OVER_LOW', P15:'P15_UNDER_SWEET', P16:'P16_HOME_WP70', P17:'P17_HOME_WP65',
    P18:'P18_WAS_HOME_OVER', P19:'P19_PIT_HOME', P20:'P20_DOME_OVER', P21:'P21_DOME_UNDER_BAN',
    P22:'P22_DUAL_LHP_UNDER', P23:'P23_DUAL_LHP_OBan', P24:'P24_ACE_HOME_UNDER',
    P25:'P25_HOU_HOME_OVER', P26:'P26_INVERSION_DAY',
  };
  const defs = PATTERN_DEFS.map(d => ({ ...d, codeKey: CODE_MAP[d.code] || d.code }));
  renderIndexTable('patternIndexTable', defs, flagData, 'codeKey', 'expML', 'expOU');
}

function renderRuleIndex(flagData) {
  const CODE_MAP = {
    R1:'R1_NO_SIGNAL', R2:'R2_LINE_9_10', R3:'R3_SINGLE_SIGNAL', R4:'R4_WPA',
    R5:'R5_PVS_OVER', R6:'R6_UNDER_SWEET', R7:'R7_GVI65', R8:'MCF',
    R9:'R9_WIND', R10:'R10_CONF_ZONE', R11:'R11_SLUMPING_SP', R12:'R12_DEAD_ZONE',
    R13:'PWF_MATCH', R14:'AWAY_ACE_OVERRIDE',
  };
  const defs = RULE_DEFS.map(d => ({ ...d, codeKey: CODE_MAP[d.code] || d.code, type: d.code }));
  renderIndexTable('ruleIndexTable', defs, flagData, 'codeKey', 'expML', 'expOU');
}

// Shared bar options helper
function baseBarOpts(d, counts, suffix, min, max) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y}${suffix} (n=${counts[ctx.dataIndex]})` } }
    },
    scales: {
      y: { min, max, ticks:{ callback: v => v+suffix }, grid:{ color:d.gridColor } },
      x: { grid:{ display:false } }
    }
  };
}

// ─── Pattern Extraction ───────────────────────────────────────────────────────
function computePatterns(data) {
  const patterns = [];
  const { overall, byDirection=[], byLineRange=[], byWP=[], byConfidence=[], byOUTier=[], byMonth=[], homeAway=[], trend=[] } = data;

  const over  = byDirection.find(d=>d.ou_prediction==='OVER')  || {total:0,ou_wins:0};
  const under = byDirection.find(d=>d.ou_prediction==='UNDER') || {total:0,ou_wins:0};

  // 1. Best OVER line range
  const overRanges = byLineRange.filter(r=>r.ou_prediction==='OVER'&&r.total>=3).sort((a,b)=>pct(b.ou_wins,b.total)-pct(a.ou_wins,a.total));
  if (overRanges.length) {
    const b=overRanges[0], p=pct(b.ou_wins,b.total);
    patterns.push({ icon:'📈', color: p>=60?'var(--green)':'var(--gold)', type: p>=58?'positive':'neutral',
      title:`Best OVER zone: line ${b.line_range} → ${p}% hit rate`,
      body:`${b.ou_wins}/${b.total} correct. Market underprices scoring at this line range — your highest-value OVER bet.` });
  }

  // 2. Best UNDER line range
  const underRanges = byLineRange.filter(r=>r.ou_prediction==='UNDER'&&r.total>=3).sort((a,b)=>pct(b.ou_wins,b.total)-pct(a.ou_wins,a.total));
  if (underRanges.length) {
    const b=underRanges[0], p=pct(b.ou_wins,b.total);
    patterns.push({ icon:'📉', color: p>=55?'var(--blue)':'var(--gold)', type: p>=55?'positive':'neutral',
      title:`Best UNDER zone: line ${b.line_range} → ${p}% hit rate`,
      body:`${b.ou_wins}/${b.total} correct. This is your structural UNDER sweet spot (framework target: 8.0–9.0 = 57.5%).` });
  }

  // 3. Best WP tier for ML
  const wpSorted = byWP.filter(w=>w.total>=3).sort((a,b)=>pct(b.ml_wins,b.total)-pct(a.ml_wins,a.total));
  if (wpSorted.length) {
    const b=wpSorted[0], p=pct(b.ml_wins,b.total);
    patterns.push({ icon:'🎯', color:'var(--gold)', type:'insight',
      title:`Strongest ML zone: WP ${b.wp_bucket} → ${p}% accuracy`,
      body:`${b.ml_wins}/${b.total} correct. Prioritize bet sizing when model confidence reaches this WP threshold.` });
  }

  // 4. OVER vs UNDER direction comparison
  if (over.total>=3 && under.total>=3) {
    const op=pct(over.ou_wins,over.total), up=pct(under.ou_wins,under.total);
    const leader=op>up?'OVER':'UNDER', diff=Math.abs(op-up).toFixed(1);
    patterns.push({ icon: leader==='OVER'?'⬆':'⬇', color: leader==='OVER'?'#e05c3a':'#3a8fe0',
      type: parseFloat(diff)>=8?'positive':'neutral',
      title:`${leader} outperforms ${leader==='OVER'?'UNDER':'OVER'} by ${diff} percentage points`,
      body:`OVER: ${op}% (${over.ou_wins}/${over.total}) · UNDER: ${up}% (${under.ou_wins}/${under.total}). Framework expects OVER ~60% overall.` });
  }

  // 5. Recent form vs all-time
  if (trend.length>=10) {
    const last10=trend.slice(-10), l10=pct(last10.filter(g=>g.ml_correct===1).length,10);
    const allml=pct(overall.ml_wins,overall.graded), diff=l10-allml;
    patterns.push({ icon: diff>3?'↑':diff<-3?'↓':'→',
      color: diff>3?'var(--green)':diff<-3?'var(--red)':'var(--text2)',
      type: diff>3?'positive':diff<-3?'warning':'neutral',
      title:`Recent form: ${diff>3?'trending UP':diff<-3?'declining':'stable'} vs all-time baseline`,
      body:`Last 10 games: ${l10}% ML vs all-time ${allml.toFixed(1)}% (${diff>0?'+':''}${diff.toFixed(1)}pp). ${diff<-5?'Consider reviewing recent picks for systemic patterns.':''}` });
  }

  // 6. O/U confidence calibration check
  const highTier = byOUTier.find(t=>t.ou_confidence==='High');
  const modTier  = byOUTier.find(t=>t.ou_confidence==='Moderate');
  if (highTier&&highTier.total>=3&&modTier&&modTier.total>=3) {
    const hp=pct(highTier.ou_wins,highTier.total), mp=pct(modTier.ou_wins,modTier.total);
    if (mp>hp+5) {
      patterns.push({ icon:'⚠', color:'var(--red)', type:'warning',
        title:`Overconfidence detected: Moderate (${mp}%) > High (${hp}%)`,
        body:`P9_BAN (cap O/U confidence at 64 for betting) is empirically validated by your data. Avoid High-tier O/U bets.` });
    } else {
      patterns.push({ icon:'✓', color:'var(--green)', type:'positive',
        title:`Confidence tiers calibrated: High ${hp}% · Moderate ${mp}%`,
        body:`Your O/U confidence tiers align with expected hierarchy. High confidence performing as intended.` });
    }
  }

  // 7. Best confidence bucket for ML
  const confSorted = byConfidence.filter(b=>b.total>=3).sort((a,b)=>pct(b.ml_wins,b.total)-pct(a.ml_wins,a.total));
  if (confSorted.length) {
    const b=confSorted[0], p=pct(b.ml_wins,b.total);
    patterns.push({ icon:'★', color:'var(--gold)', type:'insight',
      title:`Top ML confidence bucket: ${b.bucket} → ${p}% (${b.ml_wins}/${b.total})`,
      body:`Highest single confidence range. Concentrate bet sizing here for best risk-adjusted returns.` });
  }

  // 8. Worst confidence bucket warning
  if (confSorted.length>1) {
    const w=confSorted[confSorted.length-1], p=pct(w.ml_wins,w.total);
    if (p<45&&w.total>=3) {
      patterns.push({ icon:'⛔', color:'var(--red)', type:'warning',
        title:`Danger zone: conf ${w.bucket} → only ${p}% (${w.ml_wins}/${w.total})`,
        body:`Losses outweigh wins at this confidence level. Avoid betting when model falls in this range.` });
    }
  }

  // 9. Home vs Away pick bias
  const hp2=homeAway.find(h=>h.pick==='Home')||{total:0,wins:0};
  const ap2=homeAway.find(h=>h.pick==='Away')||{total:0,wins:0};
  if (hp2.total>=3&&ap2.total>=3) {
    const hpct=pct(hp2.wins,hp2.total), apct=pct(ap2.wins,ap2.total);
    const freq=+(hp2.total/(hp2.total+ap2.total)*100).toFixed(1);
    patterns.push({ icon: freq>62?'🏠':'✈', color: hpct>apct?'var(--green)':'var(--gold)', type:'neutral',
      title:`Home picks: ${freq}% of bets · ${hpct}% accuracy (Away: ${apct}%)`,
      body:`${freq>62?'Home bias detected — April away-correction rules should reduce this over time.':'Healthy home/away balance.'} Away picks: ${ap2.wins}/${ap2.total} correct.` });
  }

  // 10. OVER prediction frequency vs target
  if (over.total+under.total>=10) {
    const freq=+(over.total/(over.total+under.total)*100).toFixed(1);
    const diff=(parseFloat(freq)-60).toFixed(1);
    patterns.push({ icon:'⚖', color:Math.abs(parseFloat(diff))<8?'var(--text2)':parseFloat(diff)>0?'#e05c3a':'#3a8fe0',
      type:'neutral',
      title:`OVER prediction rate: ${freq}% (framework target ~60%)`,
      body:`OVER: ${over.total} · UNDER: ${under.total}. ${Math.abs(parseFloat(diff))>10?`${parseFloat(diff)>0?'Over-calling OVER':'Over-calling UNDER'} vs target — review signal routing.`:'Balanced with framework target.'}` });
  }

  // 11. Low-scoring game detection accuracy
  if (under.total>=5) {
    const p=pct(under.ou_wins,under.total);
    patterns.push({ icon:'🧱', color: p>=55?'var(--green)':p>=48?'var(--gold)':'var(--red)',
      type: p>=55?'positive':p>=48?'neutral':'warning',
      title:`Low-scoring game detection: ${p}% UNDER accuracy (${under.ou_wins}/${under.total})`,
      body: p>=55?'UNDER model profitable. Maintain full 7-gate filter and current sizing.' : p>=48?'UNDER near breakeven. Apply gates strictly. Avoid sub-8.0 lines.' : 'UNDER below breakeven. Increase gate strictness or reduce unit size until accuracy recovers.' });
  }

  // 12. Best monthly period
  const monthsSorted=byMonth.filter(m=>m.total>=3).sort((a,b)=>pct(b.ml_wins,b.total)-pct(a.ml_wins,a.total));
  if (monthsSorted.length) {
    const b=monthsSorted[0], p=pct(b.ml_wins,b.total);
    patterns.push({ icon:'📅', color:'var(--green)', type:'insight',
      title:`Best period: ${b.month} → ${p}% ML (${b.ml_wins}/${b.total})`,
      body:`Highest framework accuracy in this month. Use as reference for model effectiveness benchmarking.` });
  }

  // 13. Worst O/U line/direction trap
  const worstRange=[...byLineRange].filter(r=>r.total>=3).sort((a,b)=>pct(a.ou_wins,a.total)-pct(b.ou_wins,b.total))[0];
  if (worstRange) {
    const p=pct(worstRange.ou_wins,worstRange.total);
    if (p<35) {
      patterns.push({ icon:'🚫', color:'var(--red)', type:'warning',
        title:`Trap: ${worstRange.ou_prediction} at ${worstRange.line_range} → ${p}% (${worstRange.ou_wins}/${worstRange.total})`,
        body:`Consistent loser in this range/direction. Framework ban rules should prevent this — verify signal routing and gate checks.` });
    }
  }

  // 14. Overall O/U health
  if (overall.ou_graded>=5) {
    const p=pct(overall.ou_wins,overall.ou_graded);
    patterns.push({ icon:'📊', color: p>=55?'var(--green)':p>=48?'var(--gold)':'var(--red)',
      type: p>=55?'positive':'neutral',
      title:`O/U model health: ${p}% overall (${overall.ou_wins}/${overall.ou_graded} graded)`,
      body: p>=55?'Positive EV sustained. OVER-first strategy is working.' : 'Review gate system if below 50% extended. April correction rules and P9_BAN are critical.' });
  }

  // 15. Overall framework assessment
  if (overall.graded>=10) {
    const p=pct(overall.ml_wins,overall.graded);
    const status=p>=58?'well above breakeven':p>=52?'above breakeven':p>=48?'near breakeven':'below breakeven';
    patterns.push({ icon:'🔭', color: p>=55?'var(--green)':p>=50?'var(--gold)':'var(--red)',
      type: p>=55?'positive':'neutral',
      title:`Framework status: ${status} — ${p.toFixed(1)}% ML (${overall.ml_wins}W–${overall.graded-overall.ml_wins}L)`,
      body:`Across ${overall.graded} graded games. v3.4 benchmark: 56.8% ML / 62%+ OVER with Slumping SP / 60.5% UNDER 8-9 line (271-game dataset).` });
  }

  return patterns.slice(0,15);
}

function renderPatternCards(patterns) {
  const grid = document.getElementById("patternsGrid");
  if (!patterns.length) {
    grid.innerHTML = `<div class="pa-no-data">Not enough graded predictions to extract patterns. Grade at least 5 games to start seeing insights.</div>`;
    return;
  }
  grid.innerHTML = patterns.map((p, i) => `
    <div class="pa-pattern-card pa-pattern--${p.type}">
      <div class="pa-pattern-header">
        <span class="pa-pattern-num">${i+1}</span>
        <span class="pa-pattern-icon" style="color:${p.color}">${p.icon}</span>
        <span class="pa-pattern-title">${esc(p.title)}</span>
      </div>
      <div class="pa-pattern-body">${esc(p.body)}</div>
    </div>`).join("");
}
