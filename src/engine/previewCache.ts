import { getSongPreviewNotes } from "@/services/tauriApi";

export type CompactNote = [number, number, number, number]; // [midi, startMs, durMs, hand]

const MAX_CACHE_SIZE = 20;
const cache = new Map<string, CompactNote[]>();
const inFlight = new Map<string, Promise<CompactNote[]>>();

export async function getCachedPreviewNotes(filePath: string): Promise<CompactNote[]> {
  const existing = cache.get(filePath);
  if (existing) {
    // Re-insert to refresh LRU order
    cache.delete(filePath);
    cache.set(filePath, existing);
    return existing;
  }

  const pending = inFlight.get(filePath);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    try {
      const notes = await getSongPreviewNotes(filePath);
      // Evict oldest if full
      if (cache.size >= MAX_CACHE_SIZE) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }
      cache.set(filePath, notes as CompactNote[]);
      return notes as CompactNote[];
    } finally {
      inFlight.delete(filePath);
    }
  })();

  inFlight.set(filePath, promise);
  return promise;
}
