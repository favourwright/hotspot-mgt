/**
 * The shape of a voucher as its own buyer sees it, and only that.
 *
 * Customers used to read their vouchers straight from Firestore through the
 * client SDK, which handed the browser the whole document. They now come through
 * /api/voucher/mine and /api/voucher/[id], so every field here is a decision, for
 * the same reason as lib/public-api-serializers.ts: a spread would publish
 * whatever gets added to the document next, like `deviceMac` or the renewal
 * bookkeeping.
 *
 * Free of firebase-admin so the client can import the type.
 */
export interface CustomerVoucher {
  id: string;
  planName: string;
  status: "active" | "expired" | "failed" | "superseded";
  username: string;
  password: string;
  duration: string;
  dataLimit: string | null;
  sharedUsers: string | null;
  createdAt: string | null;
  expiresAt: string | null;
}

function iso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return null;
}

export function serializeCustomerVoucher(
  id: string,
  data: Record<string, unknown>
): CustomerVoucher {
  return {
    id,
    planName: String(data.planName ?? ""),
    status: data.status as CustomerVoucher["status"],
    username: String(data.username ?? ""),
    password: String(data.password ?? ""),
    duration: String(data.duration ?? ""),
    dataLimit: typeof data.dataLimit === "string" ? data.dataLimit : null,
    sharedUsers: typeof data.sharedUsers === "string" ? data.sharedUsers : null,
    createdAt: iso(data.createdAt),
    expiresAt: iso(data.expiresAt),
  };
}

/** A tenant id from a query string, safe to put in a Firestore path. */
export function isPlainDocumentId(value: string | null): value is string {
  return Boolean(value) && /^[A-Za-z0-9_-]{1,128}$/.test(value as string);
}

/** Generous for a person, and a ceiling on what one account can spend on reads. */
export const CUSTOMER_VOUCHER_LIMIT = { max: 60, windowMs: 60_000 };
/** Nobody reads further back than this on a phone, and it bounds the query. */
export const CUSTOMER_VOUCHER_PAGE = 50;
