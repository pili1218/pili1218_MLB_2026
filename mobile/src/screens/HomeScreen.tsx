import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getStats } from '../api';
import type { Stats } from '../types';
import type { RootStackParamList } from '../navigation';
import { C } from '../colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

function accColor(pct: number) {
  return pct >= 58 ? C.green : pct >= 50 ? C.gold : C.red;
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <View style={s.kpiCard}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiVal, color ? { color } : {}]}>{value}</Text>
      <Text style={s.kpiSub}>{sub}</Text>
    </View>
  );
}

export default function HomeScreen({ navigation }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      setError(null);
      setStats(await getStats());
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    }
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
      <Text style={s.dimText}>Connecting to Railway…</Text>
    </View>
  );

  if (error) return (
    <View style={s.center}>
      <Text style={s.errText}>{error}</Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
        <Text style={s.retryTxt}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  const mlPct = stats ? stats.ml_wins / Math.max(stats.graded, 1) * 100 : 0;
  const ouPct = stats ? stats.ou_wins / Math.max(stats.ou_graded, 1) * 100 : 0;
  const fmtPct = (w: number, d: number) => d > 0 ? (w / d * 100).toFixed(1) + '%' : '—';

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      <View style={s.hero}>
        <Text style={s.heroTitle}>MLB Game Predictor</Text>
        <Text style={s.heroSub}>Framework v3.6 · {stats?.total ?? 0} predictions tracked</Text>
      </View>

      <View style={s.section}>
        <Text style={s.secTitle}>OVERALL ACCURACY</Text>
        <View style={s.row}>
          <KpiCard label="Total Predictions" value={String(stats?.total ?? '—')} sub={`${stats?.graded ?? 0} graded`} />
          <KpiCard label="ML Accuracy" value={fmtPct(stats?.ml_wins ?? 0, stats?.graded ?? 0)} sub={`${stats?.ml_wins ?? 0}W · ${stats?.ml_losses ?? 0}L`} color={accColor(mlPct)} />
        </View>
        <View style={s.row}>
          <KpiCard label="O/U Accuracy" value={fmtPct(stats?.ou_wins ?? 0, stats?.ou_graded ?? 0)} sub={`${stats?.ou_wins ?? 0}W · ${stats?.ou_losses ?? 0}L`} color={accColor(ouPct)} />
          <KpiCard label="Last 10 ML" value={stats?.last10_ml != null ? stats.last10_ml + '%' : '—'} sub="rolling form" color={accColor(stats?.last10_ml ?? 0)} />
        </View>
        <View style={s.row}>
          <KpiCard label="Last 5 ML" value={stats?.last5_ml != null ? stats.last5_ml + '%' : '—'} sub="last 5 games" color={accColor(stats?.last5_ml ?? 0)} />
          <KpiCard label="Last 10 O/U" value={stats?.last10_ou != null ? stats.last10_ou + '%' : '—'} sub="O/U recent" color={accColor(stats?.last10_ou ?? 0)} />
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.secTitle}>V3.6 BENCHMARKS (314-game dataset)</Text>
        {[
          ['ML overall', '55.3%', C.green],
          ['OVER overall', '54.5%', C.green],
          ['UNDER at 8.0–9.0 line', '57.5%', C.green],
          ['Breakeven needed', '52.4%', C.gold],
          ['Never-Pass lean tracking', 'v3.6', C.blue],
        ].map(([lbl, val, col]) => (
          <View key={lbl} style={s.benchRow}>
            <Text style={s.benchLbl}>{lbl}</Text>
            <Text style={[s.benchVal, { color: col as string }]}>{val}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={s.navBtn} onPress={() => navigation.navigate('History')}>
        <Text style={s.navBtnTxt}>View Prediction History →</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[s.navBtn, s.navBtnAlt]} onPress={() => navigation.navigate('Patterns')}>
        <Text style={s.navBtnTxt}>⬡ Pattern Analysis →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: C.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 12 },
  dimText:   { color: C.text3, fontSize: 13, marginTop: 8 },
  errText:   { color: C.red, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn:  { backgroundColor: C.bg2, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  retryTxt:  { color: C.text1, fontWeight: '600' },
  hero:      { padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: C.border },
  heroTitle: { fontSize: 22, fontWeight: '800', color: C.text1 },
  heroSub:   { fontSize: 13, color: C.text3, marginTop: 4 },
  section:   { margin: 16, marginBottom: 0 },
  secTitle:  { fontSize: 11, fontWeight: '700', color: C.text3, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  row:       { flexDirection: 'row', gap: 10, marginBottom: 10 },
  kpiCard:   { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  kpiLabel:  { fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  kpiVal:    { fontSize: 26, fontWeight: '700', color: C.text1, lineHeight: 30 },
  kpiSub:    { fontSize: 11, color: C.text3, marginTop: 3 },
  benchRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  benchLbl:  { fontSize: 13, color: C.text2 },
  benchVal:  { fontSize: 13, fontWeight: '600' },
  navBtn:    { margin: 16, marginTop: 20, backgroundColor: C.accent, borderRadius: 12, padding: 16, alignItems: 'center' },
  navBtnAlt: { marginTop: 0, backgroundColor: '#1a3a5c' },
  navBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
