/**
 * The voucher lists, paged and counted by Firestore rather than in memory.
 *
 * `lib/transactions.ts` is the reference implementation and this is a
 * deliberate copy of it rather than a second design - same cursor shape,
 * same "totals come from aggregations", same "search is a lookup". Read that
 * file's comments first; only what differs is explained here.
 *
 * What this replaces: `/{slug}/admin/vouchers` and `/{slug}/admin/failed`
 * both called `getTenantVouchers(tenantId)` with no bound, so each page view
 * read and billed **every voucher the tenant had ever issued** and then
 * filtered the array in the browser. Unlike the per-request reads that the
 * caches now absorb, this one grows with the business rather than with
 * traffic: a tenant selling thirty vouchers a day crosses ten thousand rows
 * in under a year, and every visit to either page pays for all of them.
 *
 * Both pages share this module because they are the same query with a
 * different status, and the failed queue is the one that must not drift from
 * it: it is where a tenant goes when a customer has paid and got nothing.
 */

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseVouchers } from "@/lib/firestore-helpers";
import { startOfTodayInDisplayZone } from "@/lib/utils";
import { Voucher } from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";

type VoucherStatus = Voucher["status"];

export const VOUCHERS_PAGE_SIZE = 25;

/**
 * The failed queue is an exception list, not a history: a tenant works
 * through it rather than browsing it, and every retry is a round trip to a
 * router. A smaller page keeps "retry everything here" a reasonable thing to
 * press.
 */
export const FAILED_PAGE_SIZE = 20;

export interface VoucherFilters {
  status: VoucherStatus | null;
  /** Inclusive, in the viewer's day terms - the caller resolves the zone. */
  from: Date | null;
  to: Date | null;
}

export const NO_VOUCHER_FILTERS: VoucherFilters = {
  status: null,
  from: null,
  to: null,
};

/**
 * A page boundary, as `<millis>_<documentId>`.
 *
 * Same two traps as the transactions cursor, and the second one is not
 * theoretical here either: voucher ids are Firestore auto-ids, which contain
 * no underscore today, but splitting on the **first** one is what makes this
 * hold regardless of what ids look like later. See docs/architecture.md.
 */
function encodeCursor(voucher: Voucher): string {
  return `${voucher.createdAt.getTime()}_${voucher.id}`;
}

function decodeCursor(
  cursor: string
): { createdAt: Timestamp; id: string } | null {
  const separator = cursor.indexOf("_");
  if (separator <= 0) return null;

  const millis = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isFinite(millis) || !id) return null;

  return { createdAt: Timestamp.fromMillis(millis), id };
}

function applyFilters(
  query: FirebaseFirestore.Query,
  filters: VoucherFilters
): FirebaseFirestore.Query {
  let next = query;
  if (filters.status) next = next.where("status", "==", filters.status);
  if (filters.from) next = next.where("createdAt", ">=", filters.from);
  if (filters.to) next = next.where("createdAt", "<=", filters.to);
  return next;
}

export interface VoucherPage {
  vouchers: Voucher[];
  /** Null when this is the last page. */
  nextCursor: string | null;
}

export async function queryVouchers(params: {
  tenantId: string;
  filters: VoucherFilters;
  cursor?: string | null;
  pageSize?: number;
}): Promise<VoucherPage> {
  const pageSize = params.pageSize ?? VOUCHERS_PAGE_SIZE;

  const collection = adminDb.collection(
    TENANT_COLLECTIONS.vouchers(params.tenantId)
  );

  let query = applyFilters(collection, params.filters)
    .orderBy("createdAt", "desc")
    // The tiebreaker the cursor depends on. Two vouchers bought in the same
    // second is ordinary on a busy portal, and without this a cursor that
    // cannot break the tie repeats a row or skips one.
    .orderBy("__name__", "desc");

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      // A DocumentReference, not the bare id: `__name__` orders by full
      // resource path, so an id alone never matches a position and "Next"
      // returns page one for ever.
      query = query.startAfter(decoded.createdAt, collection.doc(decoded.id));
    }
  }

  const snapshot = await query.limit(pageSize + 1).get();
  const vouchers = parseVouchers(snapshot.docs.slice(0, pageSize));
  const hasMore = snapshot.docs.length > pageSize;

  return {
    vouchers,
    nextCursor:
      hasMore && vouchers.length > 0
        ? encodeCursor(vouchers[vouchers.length - 1])
        : null,
  };
}

export interface VoucherTotals {
  /** Rows matching the filter, whatever their status. */
  count: number;
  /** Of those, the ones still running. Zero when the filter excludes them. */
  activeCount: number;
  /** Today, in the display zone, ignoring any date filter. */
  todayCount: number;
}

/**
 * The figures behind the cards, read without sending the documents.
 *
 * `activeCount` goes to zero when the list is filtered to a status that is
 * not "active", for the same reason the transactions page zeroes its
 * collected figure under a failed-only filter: a number next to a list it
 * does not describe reads as describing it.
 *
 * Today deliberately ignores the date filter - it is a fixed reference point
 * beside the filtered figures, not another view of them - and it is a real
 * Lagos day, not the server's UTC one.
 *
 * Archived vouchers are counted. The reconciliation view in
 * `getTenantVouchersByLocation` filters them out because it is asking "what
 * should exist on the router"; this is asking "what did this business
 * sell", and an archived row is still a sale that happened.
 */
export async function getVoucherTotals(params: {
  tenantId: string;
  filters: VoucherFilters;
}): Promise<VoucherTotals> {
  const collection = adminDb.collection(
    TENANT_COLLECTIONS.vouchers(params.tenantId)
  );
  const todayStart = startOfTodayInDisplayZone();

  const activeApplies =
    params.filters.status === null || params.filters.status === "active";

  const [filtered, active, today] = await Promise.all([
    applyFilters(collection, params.filters).count().get(),
    activeApplies
      ? applyFilters(collection, { ...params.filters, status: "active" })
          .count()
          .get()
      : null,
    collection.where("createdAt", ">=", todayStart).count().get(),
  ]);

  return {
    count: filtered.data().count,
    activeCount: active ? active.data().count : 0,
    todayCount: today.data().count,
  };
}

/** Just the row count, for the failed queue - it has no other figure. */
export async function getVoucherCount(params: {
  tenantId: string;
  filters: VoucherFilters;
}): Promise<number> {
  const snapshot = await applyFilters(
    adminDb.collection(TENANT_COLLECTIONS.vouchers(params.tenantId)),
    params.filters
  )
    .count()
    .get();
  return snapshot.data().count;
}

/**
 * Find a voucher by exactly what someone pasted in.
 *
 * A wifi username or a customer's email address, both matched whole.
 * Firestore has no substring or case-insensitive matching, so this cannot be
 * the old "search" box that filtered an array it had already downloaded -
 * that box only worked *because* the page read everything, which is the cost
 * this change exists to remove.
 *
 * Location is deliberately not searchable here. It was in the old filter,
 * but "which vouchers at this location" is a question the page's own data
 * cannot answer by exact string match the way a username can, and a lookup
 * that silently needs the location's name typed perfectly is worse than not
 * offering it.
 */
export async function lookupVouchers(params: {
  tenantId: string;
  term: string;
}): Promise<Voucher[]> {
  const term = params.term.trim();
  if (!term) return [];

  const collection = adminDb.collection(
    TENANT_COLLECTIONS.vouchers(params.tenantId)
  );

  const [byUsername, byEmail] = await Promise.all([
    collection.where("username", "==", term).limit(25).get(),
    collection
      .where("userEmail", "==", term.toLowerCase())
      .orderBy("createdAt", "desc")
      .limit(25)
      .get(),
  ]);

  // A username and an email can both match when someone pastes something
  // that is somehow each, so the ids are deduped rather than assumed
  // disjoint.
  const seen = new Set<string>();
  const docs = [...byUsername.docs, ...byEmail.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });

  return parseVouchers(docs);
}
