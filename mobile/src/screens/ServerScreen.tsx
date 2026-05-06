import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import {
  getBaseUrl, setServerUrl, resetToDefault,
  testConnection, SERVERS, isRailway, isLocal,
} from '../config';
import { C } from '../colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Server'>;

type Status = { ok: boolean; ms: number; error?: string } | null;

function StatusDot({ status, testing }: { status: Status; testing: boolean }) {
  if (testing) return <ActivityIndicator size="small" color={C.gold} />;
  if (!status) return <View style={[dot.base, { backgroundColor: C.text3 }]} />;
  return <View style={[dot.base, { backgroundColor: status.ok ? C.green : C.red }]} />;
}

export default function ServerScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(getBaseUrl());
  const [custom, setCustom]   = useState('');
  const [testing, setTesting] = useState(false);
  const [status, setStatus]   = useState<Status>(null);

  useEffect(() => {
    // Show current in custom field if it's not one of the presets
    const isPreset = Object.values(SERVERS).includes(current as any);
    if (!isPreset) setCustom(current);
    // Auto-test current connection
    runTest(current);
  }, []);

  async function runTest(url: string) {
    setTesting(true);
    setStatus(null);
    const result = await testConnection(url);
    setStatus(result);
    setTesting(false);
  }

  async function selectServer(url: string) {
    await setServerUrl(url);
    setCurrent(url);
    runTest(url);
  }

  async function applyCustom() {
    const url = custom.trim();
    if (!url) return;
    if (!url.startsWith('http')) {
      Alert.alert('Invalid URL', 'URL must start with http:// or https://');
      return;
    }
    await selectServer(url);
  }

  async function handleReset() {
    await resetToDefault();
    setCurrent(SERVERS.railway);
    setCustom('');
    runTest(SERVERS.railway);
  }

  const presets: { key: string; label: string; sub: string; url: string }[] = [
    {
      key: 'railway',
      label: '☁️ Railway (Production)',
      sub: 'pili1218mlb2026.up.railway.app',
      url: SERVERS.railway,
    },
    {
      key: 'local',
      label: '🏠 Local (192.168.1.3)',
      sub: 'Same WiFi required · port 3000',
      url: SERVERS.local,
    },
  ];

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Current connection status */}
      <View style={s.statusBar}>
        <StatusDot status={status} testing={testing} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.statusUrl} numberOfLines={1}>{current}</Text>
          <Text style={s.statusSub}>
            {testing ? 'Testing connection…' :
             status?.ok ? `Connected · ${status.ms}ms` :
             status?.error ? `Failed: ${status.error}` : 'Not tested'}
          </Text>
        </View>
        <TouchableOpacity style={s.testBtn} onPress={() => runTest(current)} disabled={testing}>
          <Text style={s.testBtnTxt}>Test</Text>
        </TouchableOpacity>
      </View>

      {/* Preset servers */}
      <Text style={s.sectionTitle}>PRESET SERVERS</Text>
      {presets.map(p => {
        const active = current === p.url;
        return (
          <TouchableOpacity
            key={p.key}
            style={[s.preset, active && s.presetActive]}
            onPress={() => selectServer(p.url)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.presetLabel, active && { color: C.accent }]}>{p.label}</Text>
              <Text style={s.presetSub}>{p.sub}</Text>
            </View>
            {active && <Text style={s.checkmark}>✓</Text>}
          </TouchableOpacity>
        );
      })}

      {/* Custom URL */}
      <Text style={s.sectionTitle}>CUSTOM URL</Text>
      <View style={s.card}>
        <Text style={s.inputLabel}>Server URL</Text>
        <TextInput
          style={s.input}
          value={custom}
          onChangeText={setCustom}
          placeholder="http://192.168.x.x:3000"
          placeholderTextColor={C.text3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={s.hint}>
          For local network: use your PC's IP address + port 3000.{'\n'}
          Find it with: ipconfig (Windows) or ifconfig (Mac).
        </Text>
        <TouchableOpacity style={s.applyBtn} onPress={applyCustom}>
          <Text style={s.applyBtnTxt}>Apply & Test</Text>
        </TouchableOpacity>
      </View>

      {/* Reset */}
      {current !== SERVERS.railway && (
        <TouchableOpacity style={s.resetBtn} onPress={handleReset}>
          <Text style={s.resetBtnTxt}>Reset to Railway (default)</Text>
        </TouchableOpacity>
      )}

      {/* Info */}
      <View style={s.infoBox}>
        <Text style={s.infoTitle}>Local server setup</Text>
        <Text style={s.infoBody}>
          1. Run the MLB Predictor server on your PC{'\n'}
          2. Connect your phone to the same WiFi{'\n'}
          3. Enter your PC's local IP (e.g. 192.168.1.3:3000){'\n'}
          4. The server must be running on port 3000
        </Text>
      </View>
    </ScrollView>
  );
}

const dot = StyleSheet.create({
  base: { width: 10, height: 10, borderRadius: 5 },
});

const s = StyleSheet.create({
  scroll:       { flex: 1, backgroundColor: C.bg },
  statusBar:    { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, margin: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  statusUrl:    { fontSize: 13, color: C.text1, fontWeight: '600' },
  statusSub:    { fontSize: 11, color: C.text3, marginTop: 2 },
  testBtn:      { backgroundColor: C.bg2, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.border },
  testBtnTxt:   { color: C.text2, fontSize: 12, fontWeight: '600' },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: C.text3, letterSpacing: 0.8, textTransform: 'uppercase', marginHorizontal: 14, marginTop: 16, marginBottom: 8 },
  preset:       { backgroundColor: C.card, marginHorizontal: 14, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, flexDirection: 'row', alignItems: 'center' },
  presetActive: { borderColor: C.accent },
  presetLabel:  { fontSize: 14, fontWeight: '600', color: C.text1, marginBottom: 2 },
  presetSub:    { fontSize: 12, color: C.text3 },
  checkmark:    { fontSize: 18, color: C.accent, fontWeight: '700' },
  card:         { backgroundColor: C.card, marginHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  inputLabel:   { fontSize: 12, color: C.text3, marginBottom: 6 },
  input:        { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  hint:         { fontSize: 11, color: C.text3, marginTop: 8, lineHeight: 16 },
  applyBtn:     { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  applyBtnTxt:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  resetBtn:     { marginHorizontal: 14, marginTop: 12, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.border },
  resetBtnTxt:  { color: C.text3, fontSize: 13 },
  infoBox:      { margin: 14, marginTop: 20, backgroundColor: C.bg2, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  infoTitle:    { fontSize: 13, fontWeight: '700', color: C.text2, marginBottom: 8 },
  infoBody:     { fontSize: 12, color: C.text3, lineHeight: 20 },
});
