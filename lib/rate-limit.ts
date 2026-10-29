/**
 * A sliding-window rate limit held in process memory.
 *
 * In memory because the app runs as one long-lived `next start` process
 * (docs/deployment.md), the same reasoning as lib/doc-cache.ts. Counters
 * reset on every restart, which is acceptable for a limit. If the app ever
 * runs as more than one process, each would count separately and this is
 * the one file to swap for a shared store.
 *
 * Bounded, because the VPS has 956 MB and an OOM in its history: at most
 * MAX_KEYS keys, oldest dropped first. Callers must only limit on a key
 * that has already been authenticated (a verified uid, never a raw header),
 * or an attacker can grow this map on demand.
 */

const MAX_KEYS = 10_000;

const windows = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  /** When the caller may try again; 0 when `ok`. */
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  limit: { max: number; windowMs: number },
  now = Date.now()
): RateLimitResult {
  const since = now - limit.windowMs;
  const hits = (windows.get(key) ?? []).filter((t) => t > since);

  if (hits.length >= limit.max) {
    windows.set(key, hits);
    return { ok: false, retryAfterMs: hits[0] + limit.windowMs - now };
  }

  hits.push(now);
  // Re-inserting moves the key to the end, so the first key in the map is
  // always the least recently used one.
  windows.delete(key);
  windows.set(key, hits);

  while (windows.size > MAX_KEYS) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }

  return { ok: true, retryAfterMs: 0 };
}

/** For tests. */
export function resetRateLimits(): void {
  windows.clear();
}
