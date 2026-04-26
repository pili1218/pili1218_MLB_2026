import type { Prediction, Stats } from './types';

const BASE = 'https://pili1218mlb2026-production.up.railway.app';

export async function getStats(): Promise<Stats> {
  const r = await fetch(`${BASE}/api/stats`);
  if (!r.ok) throw new Error(`Stats fetch failed: ${r.status}`);
  return r.json();
}

export async function getPredictions(
  page = 1,
  limit = 30,
): Promise<{ data: Prediction[]; total: number }> {
  const r = await fetch(`${BASE}/api/predictions?page=${page}&limit=${limit}`);
  if (!r.ok) throw new Error(`Predictions fetch failed: ${r.status}`);
  return r.json();
}

export async function postResult(
  id: number,
  homeScore: number,
  awayScore: number,
  notes: string,
): Promise<{ success: boolean; error?: string }> {
  const r = await fetch(`${BASE}/api/result/${id}`, {
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
