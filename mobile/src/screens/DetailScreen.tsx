import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { postResult } from '../api';
import { getById, updateInCache } from '../cache';
import type { Prediction } from '../types';
import type { RootStackParamList } from '../navigation';
import { C } from '../colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Detail'>;

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={i.row}>
      <Text style={i.label}>{label}</Text>
      <Text style={[i.value, color ? { color } : {}]} numberOfLines={4}>{value}</Text>
    </View>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sec.wrap}>
      <Text style={sec.title}>{title}</Text>
      <View style={sec.card}>{children}</View>
    </View>
  );
}

function resColor(correct: number | null) {
  return correct === 1 ? C.green : correct === 0 ? C.red : C.text3;
}

export default function DetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();

  const [pred, setPred] = useState<Prediction | null>(null);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = getById(id);
    if (p) setPred(p);
  }, [id]);

  if (!pred) return (
    <View style={s.center}>
      <ActivityIndicator color={C.accent} />
      <Text style={s.dimTxt}>Loading…</Text>
    </View>
  );

  const home = pred.home_team ?? 'Home';
  const away = pred.away_team ?? 'Away';
  const isGraded = pred.ml_correct !== null;
  const ouDir = pred.ou_prediction
    ? `${pred.ou_prediction} ${pred.ou_line ?? ''}${pred.ou_confidence ? ` (${pred.ou_confidence})` : ''}`
    : '—';
  const ouLow = pred.ou_over_pct != null
    ? `${pred.ou_prediction === 'OVER' ? 100 - pred.ou_over_pct : pred.ou_over_pct}% low-scoring`
    : null;

  async function submitGrade() {
    const hs = parseInt(homeScore, 10);
    const as_ = parseInt(awayScore, 10);
    if (isNaN(hs) || isNaN(as_) || hs < 0 || as_ < 0) {
      Alert.alert('Invalid scores', 'Enter valid scores for both teams.');
      return;
    }
    setSaving(true);
    try {
      await postResult(id, hs, as_, notes.trim());
      const updated: Prediction = {
        ...pred,
        actual_home_score: hs,
        actual_away_score: as_,
        actual_total: hs + as_,
        ml_correct: pred.home_win_pct != null
          ? ((hs > as_ && pred.home_win_pct > 50) || (as_ > hs && pred.home_win_pct < 50) ? 1 : 0)
          : null,
        ou_correct: pred.ou_line != null
          ? ((hs + as_ > parseFloat(pred.ou_line) && pred.ou_prediction === 'OVER') ||
             (hs + as_ < parseFloat(pred.ou_line) && pred.ou_prediction === 'UNDER') ? 1 : 0)
          : null,
        notes: notes.trim() || pred.notes,
      };
      updateInCache(updated);
      setPred(updated);
      setSaved(true);
    } catch (e: any) {
      Alert.alert('Save failed', e.message ?? 'Could not save result.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.header}>
          <Text style={s.matchup}>{away} @ {home}</Text>
          <Text style={s.sub}>{pred.game_date ?? '—'}  ·  {pred.season_type ?? 'Regular Season'}</Text>
        </View>

        {(pred.home_starter || pred.away_starter) && (
          <Sec title="STARTING PITCHERS">
            {pred.home_starter && <Row label={`${home} SP`} value={pred.home_starter} />}
            {pred.away_starter && <Row label={`${away} SP`} value={pred.away_starter} />}
          </Sec>
        )}

        <Sec title="PREDICTION">
          <Row label="Win Probability" value={`${home} ${pred.home_win_pct ?? '?'}%  ·  ${away} ${pred.away_win_pct ?? '?'}%`} />
          <Row label="O/U Direction" value={ouDir} />
          {ouLow && <Row label="Low-scoring confidence" value={ouLow} />}
          <Row
            label="Framework Confidence"
            value={pred.confidence_score != null ? String(pred.confidence_score) : '—'}
            color={pred.confidence_score != null
              ? pred.confidence_score >= 60 ? C.green : pred.confidence_score >= 50 ? C.gold : C.text2
              : undefined}
          />
          {pred.gvi != null && <Row label="GVI" value={String(pred.gvi)} />}
        </Sec>

        {pred.betting_recommendation && (
          <Sec title="BETTING RECOMMENDATION">
            <Text style={s.betRec}>{pred.betting_recommendation}</Text>
          </Sec>
        )}

        {pred.key_driver && (
          <Sec title="KEY DRIVER">
            <Text style={s.bodyTxt}>{pred.key_driver}</Text>
          </Sec>
        )}

        {pred.reasoning && (
          <Sec title="ANALYSIS">
            <Text style={s.bodyTxt}>{pred.reasoning}</Text>
          </Sec>
        )}

        {isGraded ? (
          <Sec title="ACTUAL RESULT">
            <Row label="Final Score" value={`${home} ${pred.actual_home_score}  –  ${pred.actual_away_score} ${away}`} />
            <Row label="Total Runs" value={String(pred.actual_total ?? (pred.actual_home_score! + pred.actual_away_score!))} />
            <Row label="ML Result" value={pred.ml_correct === 1 ? '✓ WIN' : pred.ml_correct === 0 ? '✗ LOSS' : '—'} color={resColor(pred.ml_correct)} />
            <Row label="O/U Result" value={pred.ou_correct === 1 ? '✓ WIN' : pred.ou_correct === 0 ? '✗ LOSS' : '—'} color={resColor(pred.ou_correct)} />
            {pred.notes ? <Row label="Notes" value={pred.notes} /> : null}
            {saved && <Text style={s.savedNote}>✓ Result saved to Railway</Text>}
          </Sec>
        ) : (
          <Sec title="ENTER RESULT">
            {saved ? (
              <View style={s.savedWrap}>
                <Text style={s.savedBig}>✓ Result Saved!</Text>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                  <Text style={s.backBtnTxt}>Back to History</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={g.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={g.label}>{home} Score</Text>
                    <TextInput style={g.input} value={homeScore} onChangeText={setHomeScore} keyboardType="numeric" placeholder="0" placeholderTextColor={C.text3} maxLength={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={g.label}>{away} Score</Text>
                    <TextInput style={g.input} value={awayScore} onChangeText={setAwayScore} keyboardType="numeric" placeholder="0" placeholderTextColor={C.text3} maxLength={2} />
                  </View>
                </View>
                <Text style={g.label}>Notes (optional)</Text>
                <TextInput style={[g.input, { marginBottom: 16 }]} value={notes} onChangeText={setNotes} placeholder="e.g. rain delay, extra innings…" placeholderTextColor={C.text3} />
                <TouchableOpacity style={[g.submitBtn, saving && { opacity: 0.6 }]} onPress={submitGrade} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={g.submitTxt}>Save Result</Text>}
                </TouchableOpacity>
              </>
            )}
          </Sec>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const i = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { fontSize: 13, color: C.text3, flex: 1 },
  value: { fontSize: 13, color: C.text1, fontWeight: '600', flex: 2, textAlign: 'right' },
});

const sec = StyleSheet.create({
  wrap:  { marginHorizontal: 14, marginTop: 16 },
  title: { fontSize: 11, fontWeight: '700', color: C.text3, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  card:  { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingTop: 2, paddingBottom: 4 },
});

const g = StyleSheet.create({
  row:       { flexDirection: 'row', gap: 12, marginBottom: 4 },
  label:     { fontSize: 12, color: C.text3, marginBottom: 6, marginTop: 10 },
  input:     { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text1, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
  submitBtn: { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

const s = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: C.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 10 },
  dimTxt:    { color: C.text3, fontSize: 13 },
  header:    { padding: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  matchup:   { fontSize: 20, fontWeight: '800', color: C.text1 },
  sub:       { fontSize: 13, color: C.text3, marginTop: 4 },
  betRec:    { fontSize: 13, color: C.gold, fontWeight: '600', paddingVertical: 10, lineHeight: 20 },
  bodyTxt:   { fontSize: 13, color: C.text2, lineHeight: 20, paddingVertical: 10 },
  savedNote: { fontSize: 12, color: C.green, textAlign: 'center', marginTop: 10 },
  savedWrap: { alignItems: 'center', paddingVertical: 20, gap: 14 },
  savedBig:  { fontSize: 20, fontWeight: '700', color: C.green },
  backBtn:   { backgroundColor: C.bg2, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  backBtnTxt:{ color: C.text1, fontWeight: '600' },
});
