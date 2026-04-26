import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getPredictions } from '../api';
import { setCache } from '../cache';
import type { Prediction } from '../types';
import type { RootStackParamList } from '../navigation';
import { C } from '../colors';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

function Badge({ correct, label }: { correct: number | null; label: string }) {
  if (correct === null) return <View style={[b.base, b.pending]}><Text style={b.txt}>{label} —</Text></View>;
  return <View style={[b.base, correct === 1 ? b.win : b.loss]}><Text style={b.txt}>{label} {correct === 1 ? 'W' : 'L'}</Text></View>;
}

function PredRow({ item, onPress }: { item: Prediction; onPress: () => void }) {
  const home = item.home_team ?? 'Home';
  const away = item.away_team ?? 'Away';
  const conf = item.confidence_score;
  const graded = item.ml_correct !== null;

  return (
    <TouchableOpacity style={r.card} onPress={onPress} activeOpacity={0.75}>
      <View style={r.top}>
        <Text style={r.date}>{item.game_date ?? '—'}</Text>
        {conf != null && (
          <Text style={[r.conf, conf >= 60 ? r.confHi : conf >= 50 ? r.confMid : r.confLo]}>conf {conf}</Text>
        )}
      </View>
      <Text style={r.matchup} numberOfLines={1}>
        <Text style={{ color: C.text2 }}>{away}</Text>
        <Text style={{ color: C.text3 }}> @ </Text>
        <Text style={{ color: C.text1 }}>{home}</Text>
      </Text>
      <Text style={r.meta} numberOfLines={1}>
        {item.home_win_pct != null ? `${item.home_win_pct}% home` : '—'}
        {item.ou_prediction ? `  ·  ${item.ou_prediction} ${item.ou_line ?? ''}` : ''}
        {item.ou_confidence ? ` (${item.ou_confidence})` : ''}
      </Text>
      {graded ? (
        <View style={r.result}>
          <Text style={r.score}>
            {home} {item.actual_home_score} — {item.actual_away_score} {away}
            {'  '}({(item.actual_home_score ?? 0) + (item.actual_away_score ?? 0)} total)
          </Text>
          <View style={r.badges}>
            <Badge correct={item.ml_correct} label="ML" />
            <Badge correct={item.ou_correct} label="O/U" />
          </View>
        </View>
      ) : (
        <View style={r.pending}>
          <Text style={r.pendingTxt}>Pending result</Text>
          <Text style={r.gradeLink}>Tap to grade →</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const LIMIT = 30;

export default function HistoryScreen({ navigation }: Props) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const fetchPage = useCallback(async (p: number, reset: boolean) => {
    const result = await getPredictions(p, LIMIT);
    setPredictions(prev => {
      const next = reset ? result.data : [...prev, ...result.data];
      setCache(next);
      return next;
    });
    setTotal(result.total);
    setPage(p + 1);
  }, []);

  useEffect(() => {
    fetchPage(1, true).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [fetchPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    try { await fetchPage(1, true); } catch (e: any) { setError(e.message); }
    setRefreshing(false);
  }, [fetchPage]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || predictions.length >= total) return;
    setLoadingMore(true);
    try { await fetchPage(page, false); } catch (_) {}
    setLoadingMore(false);
  }, [loadingMore, predictions.length, total, page, fetchPage]);

  if (loading) return <View style={s.center}><ActivityIndicator color={C.accent} size="large" /><Text style={s.dimTxt}>Loading…</Text></View>;
  if (error)   return <View style={s.center}><Text style={s.errTxt}>{error}</Text></View>;

  const graded   = predictions.filter(p => p.ml_correct !== null).length;
  const mlWins   = predictions.filter(p => p.ml_correct === 1).length;
  const ouWins   = predictions.filter(p => p.ou_correct === 1).length;
  const ouGraded = predictions.filter(p => p.ou_correct !== null).length;
  const mlAcc    = graded   > 0 ? (mlWins   / graded   * 100).toFixed(0) + '%' : '—';
  const ouAcc    = ouGraded > 0 ? (ouWins   / ouGraded * 100).toFixed(0) + '%' : '—';

  return (
    <FlatList
      data={predictions}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.3}
      ListHeaderComponent={
        <View style={s.header}>
          <View style={s.pills}>
            {[['Total', String(total)], ['ML', mlAcc], ['O/U', ouAcc], ['Graded', String(graded)]].map(([lbl, val]) => (
              <View key={lbl} style={s.pill}>
                <Text style={s.pillNum}>{val}</Text>
                <Text style={s.pillLbl}>{lbl}</Text>
              </View>
            ))}
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <PredRow item={item} onPress={() => navigation.navigate('Detail', { id: item.id })} />
      )}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={C.accent} style={{ margin: 20 }} /> : null}
    />
  );
}

const b = StyleSheet.create({
  base:    { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 5 },
  pending: { backgroundColor: C.bg2 },
  win:     { backgroundColor: 'rgba(34,197,94,0.18)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)' },
  loss:    { backgroundColor: 'rgba(239,68,68,0.18)',  borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
  txt:     { fontSize: 11, fontWeight: '700', color: C.text1 },
});

const r = StyleSheet.create({
  card:       { backgroundColor: C.card, marginHorizontal: 12, marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  top:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  date:       { fontSize: 12, color: C.text3 },
  conf:       { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  confHi:     { color: C.green, backgroundColor: 'rgba(34,197,94,0.12)' },
  confMid:    { color: C.gold,  backgroundColor: 'rgba(245,197,24,0.12)' },
  confLo:     { color: C.text3, backgroundColor: C.bg2 },
  matchup:    { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  meta:       { fontSize: 12, color: C.text2, marginBottom: 8 },
  result:     { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  score:      { fontSize: 13, color: C.text1, fontWeight: '600', marginBottom: 6 },
  badges:     { flexDirection: 'row' },
  pending:    { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  pendingTxt: { fontSize: 12, color: C.text3 },
  gradeLink:  { fontSize: 12, color: C.blue, fontWeight: '600' },
});

const s = StyleSheet.create({
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 10 },
  dimTxt:   { color: C.text3, fontSize: 13 },
  errTxt:   { color: C.red, fontSize: 14 },
  header:   { padding: 12, paddingBottom: 4 },
  pills:    { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  pill:     { alignItems: 'center' },
  pillNum:  { fontSize: 18, fontWeight: '700', color: C.text1 },
  pillLbl:  { fontSize: 11, color: C.text3, marginTop: 2 },
});
