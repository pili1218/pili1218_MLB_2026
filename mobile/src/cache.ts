import type { Prediction } from './types';

// Module-level cache so history list data is accessible in detail screen without re-fetch
let _cache: Prediction[] = [];

export function setCache(preds: Prediction[]) {
  _cache = preds;
}

export function getById(id: number): Prediction | null {
  return _cache.find(p => p.id === id) ?? null;
}

export function updateInCache(updated: Prediction) {
  const idx = _cache.findIndex(p => p.id === updated.id);
  if (idx !== -1) _cache[idx] = updated;
}
