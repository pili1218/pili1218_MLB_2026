import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@mlb_server_url';

export const SERVERS = {
  railway: 'https://pili1218mlb2026-production.up.railway.app',
  local:   'http://192.168.1.3:3000',
} as const;

export type ServerKey = keyof typeof SERVERS;

// Module-level cache so api.ts can call getBaseUrl() synchronously after init
let _baseUrl: string = SERVERS.railway;

export function getBaseUrl(): string {
  return _baseUrl;
}

export async function loadServerUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) _baseUrl = saved;
  } catch {}
  return _baseUrl;
}

export async function setServerUrl(url: string): Promise<void> {
  _baseUrl = url.replace(/\/$/, ''); // strip trailing slash
  await AsyncStorage.setItem(STORAGE_KEY, _baseUrl);
}

export async function resetToDefault(): Promise<void> {
  _baseUrl = SERVERS.railway;
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export function isRailway(): boolean {
  return _baseUrl === SERVERS.railway;
}

export function isLocal(): boolean {
  return _baseUrl === SERVERS.local || _baseUrl.startsWith('http://192.168') || _baseUrl.startsWith('http://10.');
}

export async function testConnection(url: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/stats`, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: r.ok, ms: Date.now() - start };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = e.name === 'AbortError' ? 'Timed out (5s)' : (e.message ?? 'Connection failed');
    return { ok: false, ms: Date.now() - start, error: msg };
  }
}
