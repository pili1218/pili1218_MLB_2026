// patterns.js — Pattern Analysis Dashboard

let _charts = {};

document.addEventListener("DOMContentLoaded", () => {
  loadPatterns();
});

async function loadPatterns() {
  try {
    const res  = await fetch("/api/pattern-analysis");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    window._patternData = data;

    document.getElementById("loadingState").style.display  = "none";
    document.getElementById("patternsContent").style.display = "block";

    renderKPIs(data);
    renderCharts(data);
    renderPatternCards(computePatterns(data));
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

  chartConfidence(data.byConfidence, d);
  chartLineRange(data.byLineRange, d);
  chartWP(data.byWP, d);
  chartDirection(data.byDirection, d);
  chartTrend(data.trend, d);
  chartOUTier(data.byOUTier, d);
  chartTotalDist(data.totalDist, d);
  chartMonthly(data.byMonth, d);
  chartHomeAway(data.homeAway, d);
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
      body:`Across ${overall.graded} graded games. v3.3 benchmark: 54.7% ML / 60.0% OVER / 57.5% UNDER at sweet spot (181-game dataset).` });
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
