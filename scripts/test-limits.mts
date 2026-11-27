/**
 * The rules behind the limits fixed in the 2026-11-27 audit, without a
 * credential, a network or Firestore: capacity boundaries, the router's
 * unused-code room, which WireGuard peers are recycled and reaped, the
 * bounded document cache, and a failure limit that only counts failures.
 *
 * What these rules cannot show, that two simultaneous creates leave exactly
 * one behind, is `npm run test:capacity-race`, against the emulator.
 *
 * Run: npm run test:limits
 */
import { hasRoom } from "../lib/tenant-capacity";
import { routerHasRoom } from "../lib/voucher-generation-rules";
import {
  isAbandoned,
  isOurTunnelAddress,
  MAX_PENDING_PEERS,
  PENDING_PEER_TTL_MS,
  pendingToRecycle,
  type WgPeerRecord,
} from "../lib/wg-peers";
import { createDocCache } from "../lib/doc-cache";
import { isRateLimited, rateLimit, resetRateLimits } from "../lib/rate-limit";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

/* ---------------------------------------------------- capacity boundaries */

check("unlimited always has room", hasRoom(1_000_000, null));
check("below the limit has room", hasRoom(4, 5));
check("at the limit is full", !hasRoom(5, 5));
check("over the limit (a downgrade) is full", !hasRoom(7, 5));
check("a limit of zero is full, not unlimited", !hasRoom(0, 0));

check("router room: exactly to the limit fits", routerHasRoom(100, 50, 150));
check("router room: one over does not", !routerHasRoom(101, 50, 150));
check("router room: in-flight codes count", !routerHasRoom(0 + 120, 50, 150));

/* ---------------------------------------------------- WireGuard peers */

const now = new Date("2026-11-27T12:00:00Z");
const peer = (over: Partial<WgPeerRecord>): WgPeerRecord => ({
  id: "p",
  tenantId: "t1",
  publicKey: "k",
  assignedIp: "10.20.0.9",
  routerId: null,
  createdAt: now,
  releasedAt: null,
  ...over,
});
const ago = (ms: number) => new Date(now.getTime() - ms);

check("a peer with a router is never abandoned", !isAbandoned(peer({ routerId: "r", createdAt: ago(365 * 86400000) }), now));
check("a released peer is abandoned at once", isAbandoned(peer({ releasedAt: now }), now));
check("a pending peer under a day is kept", !isAbandoned(peer({ createdAt: ago(PENDING_PEER_TTL_MS - 1) }), now));
check("a pending peer a day old is abandoned", isAbandoned(peer({ createdAt: ago(PENDING_PEER_TTL_MS) }), now));
check("a pending peer with no date is abandoned", isAbandoned(peer({ createdAt: null }), now));

const pending = [3, 1, 4, 2].map((h) => peer({ id: `h${h}`, createdAt: ago(h * 3600000) }));
check("room to spare recycles nothing", pendingToRecycle(pending.slice(0, MAX_PENDING_PEERS - 1)).length === 0);
const recycled = pendingToRecycle(pending);
check(
  "at the cap, the oldest go until one more fits",
  recycled.length === pending.length - (MAX_PENDING_PEERS - 1) &&
    recycled.map((p) => p.id).join() === "h4,h3",
  recycled.map((p) => p.id).join()
);

check("our tunnel address", isOurTunnelAddress("10.20.0.17"));
check("another product's tunnel is not ours", !isOurTunnelAddress("10.10.10.5"));
check("a public address is not a tunnel", !isOurTunnelAddress("102.89.1.1"));
check("garbage is not an address", !isOurTunnelAddress("10.20.0.017"));

/* ---------------------------------------------------- the bounded cache */

{
  const cache = createDocCache<string | null>(60_000, { maxEntries: 3 });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return null;
  };
  for (const k of ["a", "b", "c", "d", "e"]) await cache.get(k, load);
  check("every miss loads once", loads === 5);
  await cache.get("e", load);
  check("a recent key stays cached", loads === 5);
  await cache.get("a", load);
  check("the oldest key was evicted past the cap", loads === 6);
  // A flood of made-up keys cannot grow it: a thousand misses later, the
  // cache still answers a recent key without loading.
  for (let i = 0; i < 1000; i++) await cache.get(`flood-${i}`, load);
  const before = loads;
  await cache.get("flood-999", load);
  check("bounded under a flood", loads === before);
}

/* ---------------------------------------------------- failure-only limits */

{
  resetRateLimits();
  const limit = { max: 2, windowMs: 60_000 };
  for (let i = 0; i < 10; i++) isRateLimited("x", limit, 1000);
  check("checking alone never trips a limit", !isRateLimited("x", limit, 1000));
  rateLimit("x", limit, 1000);
  rateLimit("x", limit, 1000);
  check("recorded failures trip it", isRateLimited("x", limit, 1000));
  check("and it lifts after the window", !isRateLimited("x", limit, 1000 + 60_001));
}

console.log(failed === 0 ? `All ${passed} cases passed.` : `${failed} failed, ${passed} passed.`);
process.exit(failed === 0 ? 0 : 1);
