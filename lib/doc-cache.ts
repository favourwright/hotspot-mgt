/**
 * A tiny in-process cache for documents that are read constantly and written
 * almost never.
 *
 * This is `lib/router-config.ts`'s cache with the router-specific parts taken
 * out - same TTL, same in-flight collapsing, same reasoning. It exists
 * because that shape kept being the right one:
 *
 *  - **The platform config document** is read on every checkout, every
 *    fee calculation and every router provision. It changes when a
 *    superadmin edits it, which is approximately never.
 *  - **A billing plan** is read by `planGrants` on every entitlement check,
 *    by `resolveFeeBearer` on every price, and by the portal's customer
 *    limit - three reads of the *same document* in one captive-portal page
 *    render, before this.
 *  - **An addon's catalog document** is read by every gate.
 *
 * Why in-process rather than `unstable_cache`: these are read from API
 * routes and cron jobs as well as from server components, and Next's data
 * cache is a request-scoped, render-oriented thing that also persists to
 * `.next/cache` on disk. A `Map` is honest about what it is, works
 * everywhere, dies with the process, and the app runs as a single
 * long-lived server (see docs/deployment.md).
 *
 * **Every writer must invalidate.** That is the whole contract, and it is
 * why this is only used for documents written by a handful of superadmin
 * routes rather than for anything a webhook or a cron job touches. A value
 * that changes from outside this process - a webhook writing through a
 * webhook on another instance, say - does not belong here; it would be
 * stale with nothing to clear it. The TTL is the backstop for that, not the
 * design.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface DocCache<T> {
  /** Read through the cache, loading on a miss. */
  get(key: string, load: () => Promise<T>): Promise<T>;
  /** Drop one key. Call from every writer, after the write commits. */
  invalidate(key: string): void;
  /** Drop everything. For a write whose blast radius isn't one key. */
  clear(): void;
}

/**
 * `ttlMs` is deliberately a per-cache decision rather than one constant:
 * how long a stale answer is tolerable depends entirely on what the value
 * decides. Five minutes suits a price list nobody is watching; something a
 * person edits and then immediately looks at wants explicit invalidation and
 * a short TTL, the way `lib/tenant-cache.ts` does it.
 */
export function createDocCache<T>(ttlMs: number): DocCache<T> {
  const entries = new Map<string, Entry<T>>();
  // Concurrent misses for the same key share one load. Several viewers
  // hitting the same tenant's portal at once is the normal case, not the
  // exception, and without this each of them pays the read.
  const inFlight = new Map<string, Promise<T>>();
  // Bumped on every invalidation. A load that was already running when the
  // write landed read the old value, so it must not be allowed to store it
  // afterwards - dropping it from `inFlight` alone would not stop that,
  // since its `.then` is already scheduled. Callers still get the value they
  // were waiting for; it simply isn't cached, and the next reader reloads.
  const generation = new Map<string, number>();

  return {
    async get(key, load) {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const startedAt = generation.get(key) ?? 0;
      const promise = load()
        .then((value) => {
          if ((generation.get(key) ?? 0) === startedAt) {
            entries.set(key, { value, expiresAt: Date.now() + ttlMs });
          }
          return value;
        })
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        });

      inFlight.set(key, promise);
      return promise;
    },

    invalidate(key) {
      entries.delete(key);
      generation.set(key, (generation.get(key) ?? 0) + 1);
    },

    clear() {
      entries.clear();
      for (const key of generation.keys()) {
        generation.set(key, (generation.get(key) ?? 0) + 1);
      }
      for (const key of inFlight.keys()) {
        generation.set(key, (generation.get(key) ?? 0) + 1);
      }
    },
  };
}
