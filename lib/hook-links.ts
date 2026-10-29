/**
 * Account linking: letting a tenant tell us which of *their* customers one
 * of ours is, in a way nobody can fake.
 *
 * ## Why it exists
 *
 * A decision hook has to decide about a person, and everything a customer
 * can type is borrowable: a member's number, a member's phone, even the
 * email on their account here (signup does not verify addresses). A hook
 * that trusts any of those lets anyone buy as a member. So the identity has
 * to come from the tenant, after the tenant has authenticated the person on
 * its own site, by whatever means it trusts: its own login, a one-time code
 * to the member's phone, a staff check.
 *
 * ## The flow
 *
 *  1. The hook answers `{"allowed": false, "requireLink": true}` for a
 *     customer it does not recognise. Checkout offers "Verify with ...".
 *  2. `/api/hooks/link/start` records a single-use state bound to the
 *     signed-in customer and sends their browser to the tenant's
 *     verification page with `state`, `uid` and `callback`.
 *  3. The tenant authenticates them and sends the browser to `callback` with
 *     `state`, `external_id`, `t` and `sig` = HMAC-SHA256 of
 *     `<t>.<state>.<external_id>` under the hook's signing secret.
 *  4. `/api/hooks/link/callback` checks the signature, that the state is
 *     unused and unexpired, and that the person arriving is the same
 *     signed-in customer who left. Then it stores the link.
 *  5. Every later hook call carries `customer.externalId`: a value only the
 *     tenant could have vouched for.
 *
 * Same signing secret as the hook itself, so it needs no API keys.
 */

import { randomBytes } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";

/** How long a customer has to finish verifying on the tenant's site. */
export const LINK_STATE_TTL_MS = 15 * 60 * 1000;

export interface LinkState {
  tenantId: string;
  hookId: string;
  uid: string;
  returnTo: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export type LinkStateProblem = "missing" | "used" | "expired" | "wrong_user";

/**
 * Whether a state may complete a link for `uid` now. Pure, so the tests
 * cover every refusal. "wrong_user" is the one that matters most: without
 * it, a customer who captured somebody else's callback URL could finish
 * that person's verification on their own account.
 */
export function checkLinkState(
  state: LinkState | null,
  uid: string,
  now: Date
): LinkStateProblem | null {
  if (!state) return "missing";
  if (state.usedAt) return "used";
  if (state.expiresAt.getTime() <= now.getTime()) return "expired";
  if (state.uid !== uid) return "wrong_user";
  return null;
}

/** The tenant's verification page, with what it needs to send them back. */
export function verificationUrl(
  linkUrl: string,
  params: { state: string; uid: string; callback: string }
): string {
  const url = new URL(linkUrl);
  url.searchParams.set("state", params.state);
  url.searchParams.set("uid", params.uid);
  url.searchParams.set("callback", params.callback);
  return url.toString();
}

export async function createLinkState(args: {
  tenantId: string;
  hookId: string;
  uid: string;
  returnTo: string;
}): Promise<string> {
  const state = randomBytes(24).toString("hex");
  const now = Date.now();
  await adminDb
    .collection(COLLECTIONS.HOOK_LINK_STATES)
    .doc(state)
    .create({
      ...args,
      expiresAt: new Date(now + LINK_STATE_TTL_MS),
      usedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      // Purged with the other short-lived records by the reconcile cron.
      deleteAt: new Date(now + 24 * 60 * 60 * 1000),
    });
  return state;
}

export async function readLinkState(state: string): Promise<LinkState | null> {
  if (!/^[0-9a-f]{48}$/.test(state)) return null;
  const snap = await adminDb.collection(COLLECTIONS.HOOK_LINK_STATES).doc(state).get();
  if (!snap.exists) return null;
  return fromData(snap.data()!);
}

/**
 * Uses the state and stores the link, atomically: of two arrivals with the
 * same state, exactly one links. The signature must already have been
 * checked by the caller. Returns the problem if it cannot complete.
 */
export async function completeLink(args: {
  state: string;
  uid: string;
  externalId: string;
}): Promise<{ ok: true; link: LinkState } | { ok: false; problem: LinkStateProblem }> {
  const stateRef = adminDb.collection(COLLECTIONS.HOOK_LINK_STATES).doc(args.state);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef);
    const state = snap.exists ? fromData(snap.data()!) : null;
    const problem = checkLinkState(state, args.uid, new Date());
    if (problem || !state) return { ok: false as const, problem: problem ?? "missing" };

    tx.update(stateRef, { usedAt: FieldValue.serverTimestamp() });
    tx.set(
      adminDb.collection(TENANT_COLLECTIONS.customerLinks(state.tenantId)).doc(args.uid),
      {
        externalId: args.externalId,
        hookId: state.hookId,
        linkedAt: FieldValue.serverTimestamp(),
      }
    );
    return { ok: true as const, link: state };
  });
}

/** The tenant's id for this customer, if the tenant has vouched for one. */
export async function getExternalId(tenantId: string, uid: string): Promise<string | null> {
  const snap = await adminDb.collection(TENANT_COLLECTIONS.customerLinks(tenantId)).doc(uid).get();
  const value = snap.data()?.externalId;
  return typeof value === "string" ? value : null;
}

function fromData(d: FirebaseFirestore.DocumentData): LinkState {
  return {
    tenantId: d.tenantId,
    hookId: d.hookId,
    uid: d.uid,
    returnTo: d.returnTo ?? "/",
    expiresAt: toDate(d.expiresAt) ?? new Date(0),
    usedAt: toDate(d.usedAt),
  };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return null;
}
