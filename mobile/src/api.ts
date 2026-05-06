import type { Prediction, Stats, PatternData, FlagStat } from './types';
import { getBaseUrl } from './config';

export async function getStats(): Promise<Stats> {
  const r = await fetch(`${getBaseUrl()}/api/stats`);
  if (!r.ok) throw new Error(`Stats fetch failed: ${r.status}`);
  return r.json();
}

export async function getPredictions(
  page = 1,
  limit = 30,
): Promise<{ data: Prediction[]; total: number }> {
  const r = await fetch(`${getBaseUrl()}/api/predictions?page=${page}&limit=${limit}`);
  if (!r.ok) throw new Error(`Predictions fetch failed: ${r.status}`);
  return r.json();
}

export async function getPatternAnalysis(): Promise<PatternData> {
  const r = await fetch(`${getBaseUrl()}/api/pattern-analysis`);
  if (!r.ok) throw new Error(`Pattern analysis fetch failed: ${r.status}`);
  return r.json();
}

export async function getFlagStats(): Promise<FlagStat[]> {
  const r = await fetch(`${getBaseUrl()}/api/flag-stats`);
  if (!r.ok) throw new Error(`Flag stats fetch failed: ${r.status}`);
  const json = await r.json();
  return json.data as FlagStat[];
}

export async function postResult(
  id: number,
  homeScore: number,
  awayScore: number,
  notes: string,
): Promise<{ success: boolean; error?: string }> {
  const r = await fetch(`${getBaseUrl()}/api/result/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actual_home_score: homeScore,
      actual_away_score: awayScore,
      notes,
    }),
  });
  if (!r.ok) throw new Error(`Result save failed: ${r.status}`);
  return r.json();
}
