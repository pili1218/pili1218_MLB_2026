import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPatternAnalysis, getFlagStats } from '../api';
import type { PatternData, FlagStat } from '../types';
import { C } from '../colors';

// ─── helpers ──────────────────────────────────────────────────────────────────
function pct(wins: number, total: number) {
  return total > 0 ? +(wins / total * 100).toFixed(1) : 0;
}
function barColor(v: number) {
  return v >= 58 ? C.green : v >= 50 ? C.gold : C.red;
}
function accColor(actual: number | null, expected: number | null): string {
  if (actual === null) return C.text3;
  // For ban/negative signals (expected < 40%), lower actual = good
  if (expected !== null && expected < 40) {
    return actual <= expected + 8 ? C.green : actual < 50 ? C.gold : C.red;
  }
  if (expected !== null) {
    return actual >= expected - 5 ? C.green : actual >= 45 ? C.gold : C.red;
  }
  return actual >= 55 ? C.green : actual >= 45 ? C.gold : C.red;
}

// ─── Mini bar row ─────────────────────────────────────────────────────────────
function BarRow({ label, value, n, max = 100 }: { label: string; value: number; n: number; max?: number }) {
  const width = `${Math.min((value / max) * 100, 100)}%` as any;
  return (
    <View style={br.wrap}>
      <Text style={br.label} numberOfLines={1}>{label}</Text>
      <View style={br.track}>
        <View style={[br.fill, { width, backgroundColor: barColor(value) }]} />
      </View>
      <Text style={[br.val, { color: barColor(value) }]}>{value}%</Text>
      <Text style={br.n}>n={n}</Text>
    </View>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sec.wrap}>
      <Text style={sec.title}>{title}</Text>
      <View style={sec.card}>{children}</View>
    </View>
  );
}

// ─── Insight card ─────────────────────────────────────────────────────────────
type Pattern = { icon: string; color: string; type: string; title: string; body: string };
function PatternCard({ p, i }: { p: Pattern; i: number }) {
  const borderColor =
    p.type === 'positive' ? C.green :
    p.type === 'warning'  ? C.red   :
    p.type === 'insight'  ? C.gold  : C.border;
  return (
    <View style={[pc.card, { borderLeftColor: borderColor }]}>
      <View style={pc.header}>
        <View style={pc.num}><Text style={pc.numTxt}>{i + 1}</Text></View>
        <Text style={[pc.icon, { color: p.color }]}>{p.icon}</Text>
        <Text style={pc.title}>{p.title}</Text>
      </View>
      <Text style={pc.body}>{p.body}</Text>
    </View>
  );
}

// ─── Flag performance card ────────────────────────────────────────────────────
function FlagCard({ f }: { f: FlagStat }) {
  const typeColor =
    f.type === 'rule'    ? C.blue   :
    f.type === 'pattern' ? C.accent : C.text3;
  const typeLbl =
    f.type === 'rule'    ? 'RULE'    :
    f.type === 'pattern' ? 'PATTERN' : 'FLAG';
  const mlColor = accColor(f.ml_accuracy, f.expected_ml);
  const ouColor = accColor(f.ou_accuracy, f.expected_ou);
  const hasData = f.ml_graded >= 3 || f.ou_graded >= 3;

  return (
    <View style={fc.card}>
      <View style={fc.header}>
        <View style={[fc.badge, { backgroundColor: typeColor + '22', borderColor: typeColor + '55' }]}>
          <Text style={[fc.badgeTxt, { color: typeColor }]}>{typeLbl}</Text>
        </View>
        <Text style={fc.label} numberOfLines={2}>{f.label}</Text>
        <Text style={fc.n}>n={f.triggered}</Text>
      </View>
      {hasData ? (
        <View style={fc.metrics}>
          {f.ml_graded >= 3 && (
            <View style={fc.metric}>
              <Text style={fc.metricLbl}>ML</Text>
              <Text style={[fc.metricVal, { color: mlColor }]}>{f.ml_accuracy}%</Text>
              {f.expected_ml != null && (
                <Text style={fc.exp}>exp {f.expected_ml}%</Text>
              )}
            </View>
          )}
          {f.ou_graded >= 3 && (
            <View style={fc.metric}>
              <Text style={fc.metricLbl}>O/U</Text>
              <Text style={[fc.metricVal, { color: ouColor }]}>{f.ou_accuracy}%</Text>
              {f.expected_ou != null && (
                <Text style={fc.exp}>exp {f.expected_ou}%</Text>
              )}
            </View>
          )}
        </View>
      ) : (
        <Text style={fc.noData}>Insufficient data (n&lt;3 graded)</Text>
      )}
    </View>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────
type Tab = 'overview' | 'charts' | 'flags';
function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'charts',   label: 'Charts' },
    { key: 'flags',    label: 'Flag Stats' },
  ];
  return (
    <View style={tb.bar}>
      {tabs.map(t => (
        <TouchableOpacity
          key={t.key}
          style={[tb.tab, tab === t.key && tb.tabActive]}
          onPress={() => setTab(t.key)}
          activeOpacity={0.7}
        >
          <Text style={[tb.txt, tab === t.key && tb.txtActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Flag filter pill row ─────────────────────────────────────────────────────
type FlagFilter = 'all' | 'rule' | 'pattern' | 'flag';
function FlagFilterBar({ filter, setFilter }: { filter: FlagFilter; setFilter: (f: FlagFilter) => void }) {
  const opts: { key: FlagFilter; label: string }[] = [
    { key: 'all',     label: 'All' },
    { key: 'rule',    label: 'Rules' },
    { key: 'pattern', label: 'Patterns' },
    { key: 'flag',    label: 'Flags' },
  ];
  return (
    <View style={ff.row}>
      {opts.map(o => (
        <TouchableOpacity
          key={o.key}
          style={[ff.pill, filter === o.key && ff.pillActive]}
          onPress={() => setFilter(o.key)}
          activeOpacity={0.7}
        >
          <Text style={[ff.txt, filter === o.key && ff.txtActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── computePatterns ──────────────────────────────────────────────────────────
function computePatterns(data: PatternData): Pattern[] {
  const patterns: Pattern[] = [];
  const { overall, byDirection = [], byLineRange = [], byWP = [], byConfidence = [], byOUTier = [], byMonth = [], homeAway = [], trend = [] } = data;

  const over  = byDirection.find(d => d.ou_prediction === 'OVER')  ?? { total: 0, ou_wins: 0 };
  const under = byDirection.find(d => d.ou_prediction === 'UNDER') ?? { total: 0, ou_wins: 0 };

  // 1. Best OVER line range
  const overRanges = [...byLineRange].filter(r => r.ou_prediction === 'OVER' && r.total >= 3).sort((a, b) => pct(b.ou_wins, b.total) - pct(a.ou_wins, a.total));
  if (overRanges.length) {
    const b = overRanges[0]; const p2 = pct(b.ou_wins, b.total);
    patterns.push({ icon: '📈', color: p2 >= 60 ? C.green : C.gold, type: p2 >= 58 ? 'positive' : 'neutral',
      title: `Best OVER zone: line ${b.line_range} → ${p2}% hit rate`,
      body: `${b.ou_wins}/${b.total} correct. Market underprices scoring at this range — highest-value OVER bet.` });
  }

  // 2. Best UNDER line range
  const underRanges = [...byLineRange].filter(r => r.ou_prediction === 'UNDER' && r.total >= 3).sort((a, b) => pct(b.ou_wins, b.total) - pct(a.ou_wins, a.total));
  if (underRanges.length) {
    const b = underRanges[0]; const p2 = pct(b.ou_wins, b.total);
    patterns.push({ icon: '📉', color: p2 >= 55 ? C.blue : C.gold, type: p2 >= 55 ? 'positive' : 'neutral',
      title: `Best UNDER zone: line ${b.line_range} → ${p2}% hit rate`,
      body: `${b.ou_wins}/${b.total} correct. Framework target: 8.0–9.0 = 57.5% (v3.6).` });
  }

  // 3. Best WP tier for ML
  const wpSorted = [...byWP].filter(w => w.total >= 3).sort((a, b) => pct(b.ml_wins, b.total) - pct(a.ml_wins, a.total));
  if (wpSorted.length) {
    const b = wpSorted[0]; const p2 = pct(b.ml_wins, b.total);
    patterns.push({ icon: '🎯', color: C.gold, type: 'insight',
      title: `Strongest ML zone: WP ${b.wp_bucket} → ${p2}% accuracy`,
      body: `${b.ml_wins}/${b.total} correct. Prioritise bet sizing when model confidence reaches this WP tier.` });
  }

  // 4. OVER vs UNDER direction
  if (over.total >= 3 && under.total >= 3) {
    const op = pct(over.ou_wins, over.total); const up = pct(under.ou_wins, under.total);
    const leader = op > up ? 'OVER' : 'UNDER'; const diff = Math.abs(op - up).toFixed(1);
    patterns.push({ icon: leader === 'OVER' ? '⬆' : '⬇', color: leader === 'OVER' ? '#e05c3a' : '#3a8fe0',
      type: parseFloat(diff) >= 8 ? 'positive' : 'neutral',
      title: `${leader} outperforms by ${diff} percentage points`,
      body: `OVER: ${op}% (${over.ou_wins}/${over.total}) · UNDER: ${up}% (${under.ou_wins}/${under.total}). v3.6 target: OVER ~60%.` });
  }

  // 5. Recent form vs all-time
  if (trend.length >= 10) {
    const last10 = trend.slice(-10); const l10 = pct(last10.filter(g => g.ml_correct === 1).length, 10);
    const allml = pct(overall.ml_wins, overall.graded); const diff = +(l10 - allml).toFixed(1);
    patterns.push({ icon: diff > 3 ? '↑' : diff < -3 ? '↓' : '→',
      color: diff > 3 ? C.green : diff < -3 ? C.red : C.text2,
      type: diff > 3 ? 'positive' : diff < -3 ? 'warning' : 'neutral',
      title: `Recent form: ${diff > 3 ? 'trending UP' : diff < -3 ? 'declining' : 'stable'} vs all-time`,
      body: `Last 10 games: ${l10}% ML vs all-time ${allml.toFixed(1)}% (${diff > 0 ? '+' : ''}${diff}pp).` });
  }

  // 6. O/U confidence calibration
  const highTier = byOUTier.find(t => t.ou_confidence === 'High');
  const modTier  = byOUTier.find(t => t.ou_confidence === 'Moderate');
  if (highTier && highTier.total >= 3 && modTier && modTier.total >= 3) {
    const hp = pct(highTier.ou_wins, highTier.total); const mp = pct(modTier.ou_wins, modTier.total);
    if (mp > hp + 5) {
      patterns.push({ icon: '⚠', color: C.red, type: 'warning',
        title: `Overconfidence: Moderate (${mp}%) > High (${hp}%)`,
        body: `P9_BAN (cap O/U conf at 64) is validated. Avoid High-tier O/U bets.` });
    } else {
      patterns.push({ icon: '✓', color: C.green, type: 'positive',
        title: `Conf tiers calibrated: High ${hp}% · Moderate ${mp}%`,
        body: `O/U confidence tiers align with the expected hierarchy.` });
    }
  }

  // 7. Best ML confidence bucket
  const confSorted = [...byConfidence].filter(b => b.total >= 3).sort((a, b) => pct(b.ml_wins, b.total) - pct(a.ml_wins, a.total));
  if (confSorted.length) {
    const b = confSorted[0]; const p2 = pct(b.ml_wins, b.total);
    patterns.push({ icon: '★', color: C.gold, type: 'insight',
      title: `Top ML conf bucket: ${b.bucket} → ${p2}% (${b.ml_wins}/${b.total})`,
      body: `Concentrate bet sizing in this range for best risk-adjusted returns.` });
  }

  // 8. Worst confidence bucket (danger zone)
  if (confSorted.length > 1) {
    const w = confSorted[confSorted.length - 1]; const p2 = pct(w.ml_wins, w.total);
    if (p2 < 45 && w.total >= 3) {
      patterns.push({ icon: '⛔', color: C.red, type: 'warning',
        title: `Danger zone: conf ${w.bucket} → only ${p2}% (${w.ml_wins}/${w.total})`,
        body: `Avoid betting when model falls in this confidence range.` });
    }
  }

  // 9. Home vs Away bias
  const hp2 = homeAway.find(h => h.pick === 'Home') ?? { total: 0, wins: 0 };
  const ap2 = homeAway.find(h => h.pick === 'Away') ?? { total: 0, wins: 0 };
  if (hp2.total >= 3 && ap2.total >= 3) {
    const hpct2 = pct(hp2.wins, hp2.total); const apct = pct(ap2.wins, ap2.total);
    const freq = +((hp2.total / (hp2.total + ap2.total)) * 100).toFixed(1);
    patterns.push({ icon: freq > 62 ? '🏠' : '✈', color: hpct2 > apct ? C.green : C.gold, type: 'neutral',
      title: `Home picks: ${freq}% of bets · ${hpct2}% acc (Away: ${apct}%)`,
      body: `${freq > 62 ? 'Home bias detected — April away-correction rules should reduce this.' : 'Healthy home/away balance.'}` });
  }

  // 10. OVER prediction frequency
  if (over.total + under.total >= 10) {
    const freq = +((over.total / (over.total + under.total)) * 100).toFixed(1);
    const diff = +(freq - 60).toFixed(1);
    patterns.push({ icon: '⚖', color: Math.abs(diff) < 8 ? C.text2 : diff > 0 ? '#e05c3a' : '#3a8fe0', type: 'neutral',
      title: `OVER prediction rate: ${freq}% (target ~60%)`,
      body: `OVER: ${over.total} · UNDER: ${under.total}. ${Math.abs(diff) > 10 ? `${diff > 0 ? 'Over-calling OVER' : 'Over-calling UNDER'} — review signal routing.` : 'Balanced with v3.6 target.'}` });
  }

  // 11. UNDER model health
  if (under.total >= 5) {
    const p2 = pct(under.ou_wins, under.total);
    patterns.push({ icon: '🧱', color: p2 >= 55 ? C.green : p2 >= 48 ? C.gold : C.red,
      type: p2 >= 55 ? 'positive' : p2 >= 48 ? 'neutral' : 'warning',
      title: `Under detection: ${p2}% accuracy (${under.ou_wins}/${under.total})`,
      body: p2 >= 55 ? 'UNDER model profitable. Maintain full 7-gate filter.' : p2 >= 48 ? 'UNDER near breakeven. Apply gates strictly. Avoid sub-8.0 lines.' : 'UNDER below breakeven. Increase gate strictness or reduce unit size.' });
  }

  // 12. Best monthly period
  const monthSorted = [...byMonth].filter(m => m.total >= 3).sort((a, b) => pct(b.ml_wins, b.total) - pct(a.ml_wins, a.total));
  if (monthSorted.length) {
    const b = monthSorted[0]; const p2 = pct(b.ml_wins, b.total);
    patterns.push({ icon: '📅', color: C.green, type: 'insight',
      title: `Best period: ${b.month} → ${p2}% ML (${b.ml_wins}/${b.total})`,
      body: `Highest framework accuracy in this period. Use as benchmark reference.` });
  }

  // 13. Worst O/U trap
  const worstRange = [...byLineRange].filter(r => r.total >= 3).sort((a, b) => pct(a.ou_wins, a.total) - pct(b.ou_wins, b.total))[0];
  if (worstRange) {
    const p2 = pct(worstRange.ou_wins, worstRange.total);
    if (p2 < 35) {
      patterns.push({ icon: '🚫', color: C.red, type: 'warning',
        title: `Trap: ${worstRange.ou_prediction} at ${worstRange.line_range} → ${p2}%`,
        body: `Consistent loser. Framework ban rules should prevent this — verify gate checks.` });
    }
  }

  // 14. O/U health overall
  if (overall.ou_graded >= 5) {
    const p2 = pct(overall.ou_wins, overall.ou_graded);
    patterns.push({ icon: '📊', color: p2 >= 55 ? C.green : p2 >= 48 ? C.gold : C.red,
      type: p2 >= 55 ? 'positive' : 'neutral',
      title: `O/U model health: ${p2}% (${overall.ou_wins}/${overall.ou_graded} graded)`,
      body: p2 >= 55 ? 'Positive EV sustained. OVER-first strategy working.' : 'Review gate system if below 50%. P9_BAN and Never-Pass lean tracking critical (v3.6).' });
  }

  // 15. Framework status
  if (overall.graded >= 10) {
    const p2 = pct(overall.ml_wins, overall.graded);
    const status = p2 >= 58 ? 'well above breakeven' : p2 >= 52 ? 'above breakeven' : p2 >= 48 ? 'near breakeven' : 'below breakeven';
    patterns.push({ icon: '🔭', color: p2 >= 55 ? C.green : p2 >= 50 ? C.gold : C.red,
      type: p2 >= 55 ? 'positive' : 'neutral',
      title: `Framework v3.6: ${status} — ${p2.toFixed(1)}% ML`,
      body: `${overall.graded} graded games. v3.6 benchmarks: 55.3% ML / 54.5% OVER / Never-Pass O/U lean policy active.` });
  }

  return patterns.slice(0, 15);
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function PatternsScreen() {
  const [data, setData]           = useState<PatternData | null>(null);
  const [flags, setFlags]         = useState<FlagStat[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [tab, setTab]             = useState<Tab>('overview');
  const [flagFilter, setFlagFilter] = useState<FlagFilter>('all');
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      setError(null);
      const [patterns, flagStats] = await Promise.all([
        getPatternAnalysis(),
        getFlagStats(),
      ]);
      setData(patterns);
      setFlags(flagStats);
    } catch (e: any) { setError(e.message ?? 'Failed to load'); }
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator color={C.accent} size="large" />
      <Text style={s.dim}>Loading analytics…</Text>
    </View>
  );
  if (error) return (
    <View style={s.center}>
      <Text style={s.err}>{error}</Text>
    </View>
  );
  if (!data) return null;

  const { overall, byConfidence = [], byLineRange = [], byWP = [], byOUTier = [], byMonth = [] } = data;
  const mlAcc  = pct(overall.ml_wins, overall.graded);
  const ouAcc  = pct(overall.ou_wins, overall.ou_graded);
  const over   = data.byDirection?.find(d => d.ou_prediction === 'OVER')  ?? { total: 0, ou_wins: 0 };
  const under  = data.byDirection?.find(d => d.ou_prediction === 'UNDER') ?? { total: 0, ou_wins: 0 };
  const patterns = computePatterns(data);

  const CONF_ORDER = ['Below 50', '50–54', '55–59', '60–64', '65–69', '70+'];
  const WP_ORDER   = ['50–54%', '55–59%', '60–64%', '65–69%', '≥70%'];
  const LINE_ORDER = ['<7.0', '7.0–7.9', '8.0–8.9', '9.0–9.9', '10.0+'];

  const visibleFlags = flagFilter === 'all'
    ? flags.filter(f => f.triggered > 0)
    : flags.filter(f => f.type === flagFilter && f.triggered > 0);

  // ─── KPI strip (shared across tabs) ────────────────────────────────────────
  const kpiStrip = (
    <View style={s.kpiRow}>
      {[
        { label: 'Total',  value: String(overall.total),         color: C.text1 },
        { label: 'ML Acc', value: mlAcc + '%',                   color: barColor(mlAcc) },
        { label: 'O/U Acc',value: ouAcc + '%',                   color: barColor(ouAcc) },
        { label: 'OVER',   value: pct(over.ou_wins, over.total) + '%',   color: '#e05c3a' },
        { label: 'UNDER',  value: pct(under.ou_wins, under.total) + '%', color: '#3a8fe0' },
        { label: 'Last 10',value: data.trend?.length >= 10
            ? pct(data.trend.slice(-10).filter(g => g.ml_correct === 1).length, 10) + '%'
            : '—',                                               color: C.gold },
      ].map(k => (
        <View key={k.label} style={s.kpiCard}>
          <Text style={s.kpiLbl}>{k.label}</Text>
          <Text style={[s.kpiVal, { color: k.color }]}>{k.value}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      {kpiStrip}
      <TabBar tab={tab} setTab={setTab} />

      {/* ── OVERVIEW TAB ───────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          {/* Monthly breakdown */}
          {byMonth.length > 0 && (
            <Section title="MONTHLY PERFORMANCE">
              {[...byMonth].filter(m => m.total >= 3).map(m => (
                <View key={m.month} style={mo.row}>
                  <Text style={mo.month}>{m.month}</Text>
                  <View style={mo.stats}>
                    <Text style={[mo.stat, { color: barColor(pct(m.ml_wins, m.total)) }]}>
                      ML {pct(m.ml_wins, m.total)}%
                    </Text>
                    {m.ou_graded > 0 && (
                      <Text style={[mo.stat, { color: barColor(pct(m.ou_wins, m.ou_graded)) }]}>
                        O/U {pct(m.ou_wins, m.ou_graded)}%
                      </Text>
                    )}
                    <Text style={mo.n}>n={m.total}</Text>
                  </View>
                </View>
              ))}
            </Section>
          )}

          {/* Insight pattern cards */}
          <View style={s.patSection}>
            <Text style={s.patTitle}>EXTRACTED INSIGHTS & TRENDS</Text>
            <Text style={s.patSub}>Algorithmically derived from your recorded prediction outcomes · v3.6 framework</Text>
            {patterns.length === 0
              ? <Text style={s.noData}>Grade at least 5 games to start seeing patterns.</Text>
              : patterns.map((p, i) => <PatternCard key={i} p={p} i={i} />)}
          </View>
        </>
      )}

      {/* ── CHARTS TAB ─────────────────────────────────────────────────────── */}
      {tab === 'charts' && (
        <>
          <Section title="ML ACCURACY BY CONFIDENCE SCORE">
            {CONF_ORDER.map(bucket => {
              const row = byConfidence.find(r => r.bucket === bucket);
              if (!row || row.total === 0) return null;
              return <BarRow key={bucket} label={bucket} value={pct(row.ml_wins, row.total)} n={row.total} />;
            })}
          </Section>

          <Section title="ML ACCURACY BY WIN PROBABILITY TIER">
            {WP_ORDER.map(bucket => {
              const row = byWP.find(r => r.wp_bucket === bucket);
              if (!row || row.total === 0) return null;
              return <BarRow key={bucket} label={bucket} value={pct(row.ml_wins, row.total)} n={row.total} />;
            })}
          </Section>

          <Section title="O/U HIT RATE BY LINE RANGE">
            {LINE_ORDER.map(range => {
              const ov = byLineRange.find(r => r.line_range === range && r.ou_prediction === 'OVER');
              const un = byLineRange.find(r => r.line_range === range && r.ou_prediction === 'UNDER');
              if (!ov && !un) return null;
              return (
                <View key={range}>
                  <Text style={s.rangeLbl}>{range}</Text>
                  {ov && ov.total > 0 && <BarRow label="  OVER"  value={pct(ov.ou_wins, ov.total)} n={ov.total} />}
                  {un && un.total > 0 && <BarRow label="  UNDER" value={pct(un.ou_wins, un.total)} n={un.total} />}
                </View>
              );
            })}
          </Section>

          <Section title="O/U ACCURACY BY CONFIDENCE TIER">
            {['Low', 'Moderate', 'High', 'Lean'].map(tier => {
              const row = byOUTier.find(r => r.ou_confidence === tier);
              if (!row || row.total === 0) return null;
              return <BarRow key={tier} label={tier} value={pct(row.ou_wins, row.total)} n={row.total} />;
            })}
          </Section>
        </>
      )}

      {/* ── FLAG STATS TAB ─────────────────────────────────────────────────── */}
      {tab === 'flags' && (
        <>
          <FlagFilterBar filter={flagFilter} setFilter={setFlagFilter} />
          <View style={s.flagMeta}>
            <Text style={s.flagMetaTxt}>
              {visibleFlags.length} active {flagFilter === 'all' ? 'flags/rules/patterns' : flagFilter + 's'} · live from {overall.total} predictions
            </Text>
          </View>
          {visibleFlags.length === 0 ? (
            <Text style={s.noData}>No {flagFilter} flags triggered in recorded predictions.</Text>
          ) : (
            visibleFlags.map(f => <FlagCard key={f.code} f={f} />)
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const br = StyleSheet.create({
  wrap:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 },
  label: { fontSize: 12, color: C.text2, width: 70 },
  track: { flex: 1, height: 7, backgroundColor: C.bg2, borderRadius: 4, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 4 },
  val:   { fontSize: 12, fontWeight: '700', width: 38, textAlign: 'right' },
  n:     { fontSize: 10, color: C.text3, width: 32, textAlign: 'right' },
});

const sec = StyleSheet.create({
  wrap:  { marginHorizontal: 14, marginTop: 16 },
  title: { fontSize: 11, fontWeight: '700', color: C.text3, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  card:  { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 6 },
});

const pc = StyleSheet.create({
  card:   { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, padding: 14, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  num:    { backgroundColor: C.bg2, borderRadius: 11, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  numTxt: { fontSize: 10, fontWeight: '700', color: C.text3 },
  icon:   { fontSize: 16, marginTop: 1 },
  title:  { flex: 1, fontSize: 13, fontWeight: '600', color: C.text1, lineHeight: 18 },
  body:   { fontSize: 12, color: C.text2, lineHeight: 18, paddingLeft: 30 },
});

const fc = StyleSheet.create({
  card:     { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginHorizontal: 14, marginTop: 10 },
  header:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  badge:    { borderRadius: 4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeTxt: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  label:    { flex: 1, fontSize: 13, fontWeight: '600', color: C.text1, lineHeight: 17 },
  n:        { fontSize: 11, color: C.text3, fontWeight: '600' },
  metrics:  { flexDirection: 'row', gap: 20, paddingTop: 4, borderTopWidth: 1, borderTopColor: C.border },
  metric:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricLbl:{ fontSize: 11, color: C.text3, fontWeight: '600', width: 24 },
  metricVal:{ fontSize: 15, fontWeight: '700' },
  exp:      { fontSize: 10, color: C.text3 },
  noData:   { fontSize: 11, color: C.text3, fontStyle: 'italic', paddingTop: 4 },
});

const tb = StyleSheet.create({
  bar:       { flexDirection: 'row', marginHorizontal: 14, marginTop: 14, backgroundColor: C.bg2, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 3 },
  tab:       { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: C.card },
  txt:       { fontSize: 13, color: C.text3, fontWeight: '600' },
  txtActive: { color: C.text1 },
});

const ff = StyleSheet.create({
  row:       { flexDirection: 'row', marginHorizontal: 14, marginTop: 12, gap: 8 },
  pill:      { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  pillActive:{ backgroundColor: C.accent, borderColor: C.accent },
  txt:       { fontSize: 12, color: C.text3, fontWeight: '600' },
  txtActive: { color: '#fff' },
});

const mo = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  month: { fontSize: 13, color: C.text1, fontWeight: '600', width: 70 },
  stats: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  stat:  { fontSize: 12, fontWeight: '700' },
  n:     { fontSize: 11, color: C.text3 },
});

const s = StyleSheet.create({
  scroll:     { flex: 1, backgroundColor: C.bg },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 10 },
  dim:        { color: C.text3, fontSize: 13 },
  err:        { color: C.red, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  kpiRow:     { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  kpiCard:    { width: '30%', backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  kpiLbl:     { fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiVal:     { fontSize: 18, fontWeight: '700', marginTop: 2 },
  rangeLbl:   { fontSize: 11, color: C.text3, marginTop: 8, marginBottom: 2, fontWeight: '600' },
  patSection: { marginHorizontal: 14, marginTop: 20 },
  patTitle:   { fontSize: 11, fontWeight: '700', color: C.text3, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  patSub:     { fontSize: 12, color: C.text3, marginBottom: 14 },
  noData:     { color: C.text3, fontSize: 13, textAlign: 'center', padding: 24, margin: 14, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  flagMeta:   { marginHorizontal: 14, marginTop: 8 },
  flagMetaTxt:{ fontSize: 11, color: C.text3 },
});
