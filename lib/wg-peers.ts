/**
 * The ledger of WireGuard peers this app has asked the VPS for.
 *
 * Every router on the tunnel takes one address from a single shared subnet
 * (`10.20.0.0/24`, about 250 addresses for the whole platform). Before this
 * ledger, `/api/admin/routers/provision` added a peer for every public key it
 * was sent and nothing ever removed one: a deleted router, an abandoned
 * wizard and a retried wizard with a fresh key each kept an address for
 * ever. The plan's `maxRouters` counted router documents, not peers, so a
 * tenant on the smallest plan could exhaust the subnet and stop every
 * tenant connecting a router.
 *
 * Now each peer has a record here, keyed by a hash of its public key (a key
 * holds `/`, which a document id may not):
 *
 *  - **provision** writes it with `routerId: null` (pending). A tenant holds
 *    at most `MAX_PENDING_PEERS` pending peers; the oldest is given back to
 *    make room, so retrying the wizard keeps working.
 *  - **router create** claims it, in the same transaction as the router
 *    document, and takes the tunnel address from the record rather than from
 *    the request. That also stops a tenant registering a router at an address
 *    provisioned for somebody else.
 *  - **router delete** gives it back.
 *  - **router-health** gives back pending peers older than a day, and any
 *    peer a failed delete left behind.
 *
 * Peers that predate the ledger get records from `npm run wg-peers:backfill`.
 */

import { createHash } from "node:crypto";
import ipaddr from "ipaddr.js";
import { FieldValue } from "firebase-admin/firestore";
import { AuthError } from "@/lib/auth-helpers";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { ROUTER_TUNNEL_SUBNETS } from "@/lib/router-address";
import { addWgPeer, removeWgPeer } from "@/lib/wg-manager";

/** Unfinished wizard attempts one tenant may hold at once. */
export const MAX_PENDING_PEERS = 3;

/** How long a provisioned peer waits for its router before it is given back. */
export const PENDING_PEER_TTL_MS = 24 * 60 * 60 * 1000;

export interface WgPeerRecord {
  id: string;
  tenantId: string;
  publicKey: string;
  assignedIp: string;
  /** Null while pending, or after a delete whose removal did not go through. */
  routerId: string | null;
  createdAt: Date | null;
  /** Set when a router let go of it; the reaper removes it straight away. */
  releasedAt: Date | null;
}

export function peerId(publicKey: string): string {
  return createHash("sha256").update(publicKey.trim()).digest("hex").slice(0, 40);
}

function peerRef(publicKey: string) {
  return adminDb.collection(COLLECTIONS.WG_PEERS).doc(peerId(publicKey));
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date } | null;
  return maybe?.toDate ? maybe.toDate() : null;
}

function parsePeer(doc: FirebaseFirestore.DocumentSnapshot): WgPeerRecord | null {
  if (!doc.exists) return null;
  const d = doc.data()!;
  return {
    id: doc.id,
    tenantId: d.tenantId,
    publicKey: d.publicKey,
    assignedIp: d.assignedIp,
    routerId: d.routerId ?? null,
    createdAt: toDate(d.createdAt),
    releasedAt: toDate(d.releasedAt),
  };
}

export function isOurTunnelAddress(ip: string): boolean {
  if (!ipaddr.IPv4.isValidFourPartDecimal(ip)) return false;
  const address = ipaddr.IPv4.parse(ip);
  return ROUTER_TUNNEL_SUBNETS.some((s) => address.match(ipaddr.IPv4.parseCIDR(s)));
}

/**
 * Which pending peers to give back so a new one fits: the oldest first, down
 * to `MAX_PENDING_PEERS - 1`. Pure, for the tests.
 */
export function pendingToRecycle(pending: WgPeerRecord[]): WgPeerRecord[] {
  const excess = pending.length - (MAX_PENDING_PEERS - 1);
  if (excess <= 0) return [];
  return [...pending]
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    .slice(0, excess);
}

/** Whether the reaper should give this peer back now. Pure, for the tests. */
export function isAbandoned(peer: WgPeerRecord, now: Date): boolean {
  if (peer.routerId) return false;
  if (peer.releasedAt) return true;
  const created = peer.createdAt?.getTime() ?? 0;
  return now.getTime() - created >= PENDING_PEER_TTL_MS;
}

/** Removes the peer from the VPS, then its record. Leaves the record if the VPS says no. */
async function givePeerBack(peer: WgPeerRecord): Promise<boolean> {
  const removed = await removeWgPeer(peer.publicKey);
  if (!removed.success && !/not found|does not exist/i.test(removed.error ?? "")) {
    console.error(`[wg-peers] could not remove ${peer.assignedIp}: ${removed.error}`);
    return false;
  }
  await adminDb.collection(COLLECTIONS.WG_PEERS).doc(peer.id).delete();
  return true;
}

/**
 * Adds a peer for this tenant's router, or returns the one this key already
 * has. Refuses a key that belongs to another tenant, or to a tunnel that is
 * not this product's.
 */
export async function provisionPeer(
  tenantId: string,
  rawPublicKey: string
): Promise<{ assignedIp: string; alreadyExists: boolean }> {
  const publicKey = rawPublicKey.trim();
  const ref = peerRef(publicKey);
  const existing = parsePeer(await ref.get());

  if (existing) {
    if (existing.tenantId !== tenantId) {
      throw new AuthError(
        "This public key is already in use. Generate a new key pair on the router and try again.",
        409
      );
    }
    return { assignedIp: existing.assignedIp, alreadyExists: true };
  }

  const mine = await adminDb
    .collection(COLLECTIONS.WG_PEERS)
    .where("tenantId", "==", tenantId)
    .limit(100)
    .get();
  const pending = mine.docs
    .map(parsePeer)
    .filter((p): p is WgPeerRecord => p !== null && p.routerId === null);
  for (const old of pendingToRecycle(pending)) await givePeerBack(old);

  const added = await addWgPeer(publicKey);
  if (!added.success || !added.data) {
    throw new AuthError(`Provisioning failed: ${added.error ?? "no address"}`, 500);
  }
  const { assignedIp, alreadyExists } = added.data;

  // A peer the VPS already had and the ledger did not. After the backfill
  // that is only ever an abandoned peer of ours, or a tunnel belonging to
  // something else on this server, which is never handed out.
  if (!isOurTunnelAddress(assignedIp)) {
    throw new AuthError(
      "This public key is already used by another tunnel on our server. Generate a new key pair on the router and try again.",
      409
    );
  }

  try {
    await ref.create({
      tenantId,
      publicKey,
      assignedIp,
      routerId: null,
      releasedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // Two requests for the same key: the other one wrote it. Fine if it was ours.
    const other = parsePeer(await ref.get());
    if (!other || other.tenantId !== tenantId) throw error;
  }
  return { assignedIp, alreadyExists };
}

/**
 * For a router create's transaction: reads the peer and checks this tenant
 * may put a router on it. Returns the write that claims it, to run in the
 * transaction's write phase, and the address the router must use.
 */
export async function readPeerForClaim(
  tx: FirebaseFirestore.Transaction,
  tenantId: string,
  publicKey: string
): Promise<{ assignedIp: string; claim: (routerId: string) => void }> {
  const ref = peerRef(publicKey);
  const peer = parsePeer(await tx.get(ref));
  if (!peer || peer.tenantId !== tenantId) {
    throw new AuthError(
      "We have no tunnel for this router's key. Go back a step and connect the tunnel again.",
      400
    );
  }
  if (peer.routerId) {
    throw new AuthError("This tunnel already belongs to one of your routers.", 409);
  }
  return {
    assignedIp: peer.assignedIp,
    claim: (routerId) => tx.update(ref, { routerId, releasedAt: null, claimedAt: FieldValue.serverTimestamp() }),
  };
}

/** After a router is deleted: gives its peer back, or leaves it for the reaper. */
export async function releaseRouterPeer(tenantId: string, publicKey: string | null | undefined): Promise<void> {
  if (!publicKey) return;
  const ref = peerRef(publicKey);
  const peer = parsePeer(await ref.get());
  if (!peer || peer.tenantId !== tenantId) return;
  await ref.update({ routerId: null, releasedAt: FieldValue.serverTimestamp() });
  await givePeerBack({ ...peer, routerId: null, releasedAt: new Date() });
}

/** For router-health: gives back every abandoned peer. */
export async function reapAbandonedPeers(now = new Date()): Promise<{ reaped: number; failed: number }> {
  // routerId alone, filtered in memory: a range on createdAt beside it would
  // need a composite index, and pending peers are a handful at most.
  const snap = await adminDb
    .collection(COLLECTIONS.WG_PEERS)
    .where("routerId", "==", null)
    .limit(200)
    .get();
  let reaped = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const peer = parsePeer(doc);
    if (!peer || !isAbandoned(peer, now)) continue;
    if (await givePeerBack(peer)) reaped += 1;
    else failed += 1;
  }
  return { reaped, failed };
}

/**
 * Router connection tests per tenant, shared by every route that logs in to
 * a router on an address the owner typed: a few dozen tries, not a dictionary.
 */
export const ROUTER_TEST_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 };

/**
 * Throws unless this tenant may talk to a router at `routerIp`. A public
 * address is anybody's to type; a tunnel address is reachable only from
 * this server, so letting one tenant test credentials against another
 * tenant's tunnel address would make this server their password-guessing
 * proxy, against a router that trusts everything arriving on its tunnel.
 *
 * The ledger answers first. A router registered before the ledger existed,
 * and not yet backfilled, is recognised by its own router document.
 */
export async function assertTunnelAddressOwned(tenantId: string, routerIp: string): Promise<void> {
  const host = routerIp.split(":")[0];
  if (!isOurTunnelAddress(host)) return;

  const byPeer = await adminDb
    .collection(COLLECTIONS.WG_PEERS)
    .where("assignedIp", "==", host)
    .limit(1)
    .get();
  if (!byPeer.empty) {
    if (byPeer.docs[0].get("tenantId") === tenantId) return;
  } else {
    const byRouter = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .where("routerIp", "==", routerIp)
      .limit(1)
      .get();
    if (!byRouter.empty) return;
  }
  throw new AuthError("That tunnel address is not one of yours. Connect the tunnel again from the wizard.", 403);
}
