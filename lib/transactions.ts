/**
 * The transactions list, paged and totalled by Firestore rather than in
 * memory.
 *
 * The page this feeds used to fetch every payment a tenant had ever taken
 * and filter the array in the browser. That works at twenty payments and is
 * the shape of the read-quota incident at twenty thousand, so status and
 * date are `where` clauses now, the rows arrive a page at a time behind a
 * cursor, and the totals come from aggregations that read the matching
 * documents without sending them.
 *
 * The one thing Firestore cannot do is substring search, so the page's
 * search box is a *lookup* (see `lookupTransactions`) rather than a filter:
 * an exact reference or email, answered by its own query. Pretending
 * otherwise would mean a search box that only sees the page you happen to
 * be on.
 */

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePayments } from "@/lib/firestore-helpers";
import { startOfTodayInDisplayZone } from "@/lib/utils";
import { Payment } from "@/types/schemas";

type PaymentStatus = Payment["status"];
import { AggregateField, Timestamp } from "firebase-admin/firestore";

export const TRANSACTIONS_PAGE_SIZE = 25;

export interface TransactionFilters {
  status: PaymentStatus | null;
  /** Inclusive, in the viewer's day terms - the caller resolves the zone. */
  from: Date | null;
  to: Date | null;
}

/**
 * A page boundary, as `<millis>_<documentId>`.
 *
 * The document id is half the cursor on purpose. Ordering by `createdAt`
 * alone has ties - two vouchers bought in the same second are not rare on a
 * busy portal - and a cursor that cannot tell them apart either repeats a
 * row on the next page or skips one.
 */
function encodeCursor(payment: Payment): string {
  return `${payment.createdAt.getTime()}_${payment.id}`;
}

function decodeCursor(
  cursor: string
): { createdAt: Timestamp; id: string } | null {
  // The FIRST underscore, not the last. Payment ids are themselves
  // `hs_<millis>_<random>`, so splitting from the right put part of the id
  // into the timestamp, made it NaN, and silently dropped the cursor - the
  // next page was the first page, for ever.
  const separator = cursor.indexOf("_");
  if (separator <= 0) return null;

  const millis = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isFinite(millis) || !id) return null;

  return { createdAt: Timestamp.fromMillis(millis), id };
}

function applyFilters(
  query: FirebaseFirestore.Query,
  filters: TransactionFilters
): FirebaseFirestore.Query {
  let next = query;
  if (filters.status) next = next.where("status", "==", filters.status);
  if (filters.from) next = next.where("createdAt", ">=", filters.from);
  if (filters.to) next = next.where("createdAt", "<=", filters.to);
  return next;
}

export interface TransactionPage {
  payments: Payment[];
  /** Null when this is the last page. */
  nextCursor: string | null;
}

export async function queryTransactions(params: {
  tenantId: string;
  filters: TransactionFilters;
  cursor?: string | null;
  pageSize?: number;
}): Promise<TransactionPage> {
  const pageSize = params.pageSize ?? TRANSACTIONS_PAGE_SIZE;

  const collection = adminDb.collection(
    TENANT_COLLECTIONS.payments(params.tenantId)
  );

  let query = applyFilters(collection, params.filters)
    .orderBy("createdAt", "desc")
    // The tiebreaker the cursor depends on. Firestore would append this
    // implicitly, but naming it makes the pairing with `startAfter` below
    // visible rather than something you have to know.
    .orderBy("__name__", "desc");

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      // A DocumentReference, not the bare id. Ordering by `__name__` orders
      // by full resource path, so a cursor carrying only the id never
      // matches a position and `startAfter` silently returns the same first
      // page forever - an infinite "Next" that never advances.
      query = query.startAfter(decoded.createdAt, collection.doc(decoded.id));
    }
  }

  // One more than asked for, so "is there a next page" is answered without a
  // second query or a count.
  const snapshot = await query.limit(pageSize + 1).get();
  const payments = parsePayments(snapshot.docs.slice(0, pageSize));
  const hasMore = snapshot.docs.length > pageSize;

  return {
    payments,
    nextCursor:
      hasMore && payments.length > 0
        ? encodeCursor(payments[payments.length - 1])
        : null,
  };
}

export interface TransactionTotals {
  /** Rows matching the filter, whatever their status. */
  count: number;
  /** Kobo actually collected: successful charges only. */
  collectedKobo: number;
  /** Today, in the display zone, ignoring any date filter. */
  todayCount: number;
  todayCollectedKobo: number;
}

/**
 * The figures behind the cards, read without sending the documents.
 *
 * Money totals count successful charges only, however the list is filtered.
 * A pending row summed into revenue reads as money that has not arrived, and
 * a failed one as money that never will.
 *
 * Today deliberately ignores the date filter: it is a fixed reference point
 * next to the filtered figures, not another view of them. It is also a real
 * Lagos day rather than the server's UTC one - see
 * `startOfTodayInDisplayZone`.
 */
export async function getTransactionTotals(params: {
  tenantId: string;
  filters: TransactionFilters;
}): Promise<TransactionTotals> {
  const collection = adminDb.collection(
    TENANT_COLLECTIONS.payments(params.tenantId)
  );
  const todayStart = startOfTodayInDisplayZone();

  // When the list is filtered to a status that is not "success", there is
  // no money to total - showing the all-time collected figure next to a
  // list of failed charges reads as though those charges collected it.
  const collectedApplies =
    params.filters.status === null || params.filters.status === "success";

  const [filtered, collected, today] = await Promise.all([
    applyFilters(collection, params.filters).count().get(),
    collectedApplies
      ? applyFilters(collection, { ...params.filters, status: "success" })
          .aggregate({ total: AggregateField.sum("amount") })
          .get()
      : null,
    collection
      .where("status", "==", "success")
      .where("createdAt", ">=", todayStart)
      .aggregate({
        count: AggregateField.count(),
        total: AggregateField.sum("amount"),
      })
      .get(),
  ]);

  return {
    count: filtered.data().count,
    collectedKobo: collected ? (collected.data().total ?? 0) : 0,
    todayCount: today.data().count,
    todayCollectedKobo: today.data().total ?? 0,
  };
}

/**
 * Find a payment by exactly what someone pasted in.
 *
 * A payment reference or a customer's email address, both matched whole.
 * Firestore has no substring or case-insensitive matching, so a partial
 * email finds nothing - which is why the field says "lookup" and not
 * "search", and why it returns rows rather than filtering the page.
 */
export async function lookupTransactions(params: {
  tenantId: string;
  term: string;
}): Promise<Payment[]> {
  const term = params.term.trim();
  if (!term) return [];

  const collection = adminDb.collection(
    TENANT_COLLECTIONS.payments(params.tenantId)
  );

  const [byReference, byEmail] = await Promise.all([
    collection.where("reference", "==", term).limit(25).get(),
    collection
      .where("userEmail", "==", term.toLowerCase())
      .orderBy("createdAt", "desc")
      .limit(25)
      .get(),
  ]);

  // Both can match when someone pastes something that is somehow each, so
  // the ids are deduped rather than assumed disjoint.
  const seen = new Set<string>();
  const docs = [...byReference.docs, ...byEmail.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });

  return parsePayments(docs);
}
