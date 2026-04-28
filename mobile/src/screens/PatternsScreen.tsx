import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPatternAnalysis } from '../api';
import type { PatternData } from '../types';
import { C } from '../colors';

// ─── helpers ──────────────────────────────────────────────────────────────────
function pct(wins: number, total: number) {
  return total > 0 ? +(wins / total * 100).toFixed(1) : 0;
}
function barColor(v: number) {
  return v >= 58 ? C.green : v >= 50 ? C.gold : C.red;
}

// ─── Mini bar chart row ───────────────────────────────────────────────────────
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

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sec.wrap}>
      <Text style={sec.title}>{title}</Text>
      <View style={sec.card}>{children}</View>
    </View>
  );
}

// ─── Pattern card ─────────────────────────────────────────────────────────────
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

// ─── Pattern computation (mirrors patterns.js) ─────────────────────────────
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
      body: `${b.ou_wins}/${b.total} correct. Structural UNDER sweet spot (framework target: 8.0–9.0 = 57.5%).` });
  }

  // 3. Best WP tier for ML
  const wpSorted = [...byWP].filter(w => w.total >= 3).sort((a, b) => pct(b.ml_wins, b.total) - pct(a.ml_wins, a.total));
  if (wpSorted.length) {
    const b = wpSorted[0]; const p2 = pct(b.ml_wins, b.total);
    patterns.push({ icon: '🎯', color: C.gold, type: 'insight',
      title: `Strongest ML zone: WP ${b.wp_bucket} → ${p2}% accuracy`,
      body: `${b.ml_wins}/${b.total} correct. Prioritize bet sizing when model confidence reaches this WP tier.` });
  }

  // 4. OVER vs UNDER direction
  if (over.total >= 3 && under.total >= 3) {
    const op = pct(over.ou_wins, over.total); const up = pct(under.ou_wins, under.total);
    const leader = op > up ? 'OVER' : 'UNDER'; const diff = Math.abs(op - up).toFixed(1);
    patterns.push({ icon: leader === 'OVER' ? '⬆' : '⬇', color: leader === 'OVER' ? '#e05c3a' : '#3a8fe0',
      type: parseFloat(diff) >= 8 ? 'positive' : 'neutral',
      title: `${leader} outperforms by ${diff} percentage points`,
      body: `OVER: ${op}% (${over.ou_wins}/${over.total}) · UNDER: ${up}% (${under.ou_wins}/${under.total}). Framework expects OVER ~60%.` });
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
        title: `Overconfidence detected: Moderate (${mp}%) > High (${hp}%)`,
        body: `P9_BAN (cap O/U confidence at 64) is validated by your data. Avoid High-tier O/U bets.` });
    } else {
      patterns.push({ icon: '✓', color: C.green, type: 'positive',
        title: `Confidence tiers calibrated: High ${hp}% · Moderate ${mp}%`,
        body: `O/U confidence tiers align with the expected hierarchy.` });
    }
  }

  // 7. Best ML confidence bucket
  const confSorted = [...byConfidence].filter(b => b.total >= 3).sort((a, b) => pct(b.ml_wins, b.total) - pct(a.ml_wins, a.total));
  if (confSorted.length) {
    const b = confSorted[0]; const p2 = pct(b.ml_wins, b.total);
    patterns.push({ icon: '★', color: C.gold, type: 'insight',
      title: `Top ML confidence bucket: ${b.bucket} → ${p2}% (${b.ml_wins}/${b.total})`,
      body: `Concentrate bet sizing in this range for best risk-adjusted returns.` });
  }

  // 8. Worst confidence bucket
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
      title: `OVER prediction rate: ${freq}% (framework target ~60%)`,
      body: `OVER: ${over.total} · UNDER: ${under.total}. ${Math.abs(diff) > 10 ? `${diff > 0 ? 'Over-calling OVER' : 'Over-calling UNDER'} — review signal routing.` : 'Balanced with framework target.'}` });
  }

  // 11. UNDER model health
  if (under.total >= 5) {
    const p2 = pct(under.ou_wins, under.total);
    patterns.push({ icon: '🧱', color: p2 >= 55 ? C.green : p2 >= 48 ? C.gold : C.red,
      type: p2 >= 55 ? 'positive' : p2 >= 48 ? 'neutral' : 'warning',
      title: `Low-scoring game detection: ${p2}% UNDER accuracy (${under.ou_wins}/${under.total})`,
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
        title: `Trap: ${worstRange.ou_prediction} at ${worstRange.line_range} → ${p2}% (${worstRange.ou_wins}/${worstRange.total})`,
        body: `Consistent loser. Framework ban rules should prevent this — verify gate checks.` });
    }
  }

  // 14. O/U health overall
  if (overall.ou_graded >= 5) {
    const p2 = pct(overall.ou_wins, overall.ou_graded);
    patterns.push({ icon: '📊', color: p2 >= 55 ? C.green : p2 >= 48 ? C.gold : C.red,
      type: p2 >= 55 ? 'positive' : 'neutral',
      title: `O/U model health: ${p2}% overall (${overall.ou_wins}/${overall.ou_graded} graded)`,
      body: p2 >= 55 ? 'Positive EV sustained. OVER-first strategy is working.' : 'Review gate system if below 50%. April correction rules and P9_BAN are critical.' });
  }

  // 15. Framework status
  if (overall.graded >= 10) {
    const p2 = pct(overall.ml_wins, overall.graded);
    const status = p2 >= 58 ? 'well above breakeven' : p2 >= 52 ? 'above breakeven' : p2 >= 48 ? 'near breakeven' : 'below breakeven';
    patterns.push({ icon: '🔭', color: p2 >= 55 ? C.green : p2 >= 50 ? C.gold : C.red,
      type: p2 >= 55 ? 'positive' : 'neutral',
      title: `Framework status: ${status} — ${p2.toFixed(1)}% ML`,
      body: `${overall.graded} graded games. v3.3 benchmark: 54.7% ML / 60.0% OVER / 57.5% UNDER at sweet spot.` });
  }

  return patterns.slice(0, 15);
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function PatternsScreen() {
  const [data, setData] = useState<PatternData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await getPatternAnalysis());
    } catch (e: any) { setError(e.message ?? 'Failed to load'); }
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) return <View style={s.center}><ActivityIndicator color={C.accent} size="large" /><Text style={s.dim}>Extracting patterns…</Text></View>;
  if (error)   return <View style={s.center}><Text style={s.err}>{error}</Text></View>;
  if (!data)   return null;

  const { overall, byConfidence = [], byLineRange = [], byWP = [], byOUTier = [] } = data;
  const mlAcc  = pct(overall.ml_wins, overall.graded);
  const ouAcc  = pct(overall.ou_wins, overall.ou_graded);
  const over   = data.byDirection?.find(d => d.ou_prediction === 'OVER')  ?? { total: 0, ou_wins: 0 };
  const under  = data.byDirection?.find(d => d.ou_prediction === 'UNDER') ?? { total: 0, ou_wins: 0 };
  const patterns = computePatterns(data);

  const CONF_ORDER = ['Below 50', '50–54', '55–59', '60–64', '65–69', '70+'];
  const WP_ORDER   = ['50–54%', '55–59%', '60–64%', '65–69%', '≥70%'];
  const LINE_ORDER = ['<7.0', '7.0–7.9', '8.0–8.9', '9.0–9.9', '10.0+'];

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      {/* KPI strip */}
      <View style={s.kpiRow}>
        {[
          { label: 'Total', value: String(overall.total), color: C.text1 },
          { label: 'ML Acc', value: mlAcc + '%', color: barColor(mlAcc) },
          { label: 'O/U Acc', value: ouAcc + '%', color: barColor(ouAcc) },
          { label: 'OVER', value: pct(over.ou_wins, over.total) + '%', color: '#e05c3a' },
          { label: 'UNDER', value: pct(under.ou_wins, under.total) + '%', color: '#3a8fe0' },
          { label: 'Last 10', value: data.trend?.length >= 10 ? pct(data.trend.slice(-10).filter(g => g.ml_correct === 1).length, 10) + '%' : '—', color: C.gold },
        ].map(k => (
          <View key={k.label} style={s.kpiCard}>
            <Text style={s.kpiLbl}>{k.label}</Text>
            <Text style={[s.kpiVal, { color: k.color }]}>{k.value}</Text>
          </View>
        ))}
      </View>

      {/* ML Accuracy by Confidence */}
      <Section title="ML ACCURACY BY CONFIDENCE SCORE">
        {CONF_ORDER.map(bucket => {
          const row = byConfidence.find(r => r.bucket === bucket);
          if (!row || row.total === 0) return null;
          return <BarRow key={bucket} label={bucket} value={pct(row.ml_wins, row.total)} n={row.total} />;
        })}
      </Section>

      {/* ML Accuracy by Win Probability */}
      <Section title="ML ACCURACY BY WIN PROBABILITY TIER">
        {WP_ORDER.map(bucket => {
          const row = byWP.find(r => r.wp_bucket === bucket);
          if (!row || row.total === 0) return null;
          return <BarRow key={bucket} label={bucket} value={pct(row.ml_wins, row.total)} n={row.total} />;
        })}
      </Section>

      {/* O/U by Line Range */}
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

      {/* O/U Accuracy by Confidence Tier */}
      <Section title="O/U ACCURACY BY CONFIDENCE TIER">
        {['Low', 'Moderate', 'High'].map(tier => {
          const row = byOUTier.find(r => r.ou_confidence === tier);
          if (!row || row.total === 0) return null;
          return <BarRow key={tier} label={tier} value={pct(row.ou_wins, row.total)} n={row.total} />;
        })}
      </Section>

      {/* Pattern Cards */}
      <View style={s.patSection}>
        <Text style={s.patTitle}>EXTRACTED PATTERNS & TRENDS</Text>
        <Text style={s.patSub}>Algorithmically derived from your recorded prediction outcomes</Text>
        {patterns.length === 0
          ? <Text style={s.noData}>Grade at least 5 games to start seeing patterns.</Text>
          : patterns.map((p, i) => <PatternCard key={i} p={p} i={i} />)}
      </View>
    </ScrollView>
  );
}

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
  noData:     { color: C.text3, fontSize: 13, textAlign: 'center', padding: 24, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border },
});
