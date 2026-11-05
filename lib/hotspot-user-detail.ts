import {
  findActiveSessionsForUser,
  findHotspotUser,
  parseMikrotikDuration,
  totalBytesUsed,
} from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";
import {
  getTenantVouchersByLocation,
  getTenantPaymentForVoucher,
} from "@/lib/firestore-helpers";
import { liveVoucherFor, parseRouterExpiryComment } from "@/lib/hotspot-users";
import { parseDataLimitBytes } from "@/lib/mikrotik";

/**
 * Everything known about one hotspot user, assembled on demand when the
 * detail dialog opens.
 *
 * Kept out of the list response deliberately: the password and the
 * lifetime byte counters are per-user detail, and sending a password for
 * every row of a table nobody has asked to inspect is exposure for no
 * benefit.
 */
export interface HotspotUserDetail {
  username: string;
  foundOnRouter: boolean;
  routerReachable: boolean;
  routerError: string | null;
  routerName: string;
  locationName: string;

  password: string | null;
  profile: string | null;
  comment: string | null;
  disabled: boolean;

  /** Time allowance and what has been consumed of it. */
  limitUptime: string | null;
  uptimeUsed: string | null;
  /** Data allowance, in bytes. */
  limitBytesTotal: number | null;
  /**
   * Consumption, in bytes, live: the router's lifetime counters plus
   * whatever every open session has moved since it logged in. The router's
   * own counters do not include an open session until it closes, so these
   * are not simply `user["bytes-in"]`. See `totalBytesUsed`.
   */
  bytesIn: number | null;
  bytesOut: number | null;
  /** `bytesIn + bytesOut`, and what the usage meter is drawn from. */
  bytesUsed: number | null;

  expiresAt: string | null;

  /**
   * How many sessions this user has open. Above 1 on a plan whose profile
   * allows several devices, and the reason the figures above are not just
   * the one session's.
   */
  sessionCount: number;

  /**
   * The longest-running open session, for the "connected right now" panel.
   * Its byte counters are that session's alone, deliberately: it is labelled
   * as one session in the UI, while the totals above cover all of them.
   */
  session: {
    address: string;
    macAddress: string;
    /** Elapsed connected time for this session. */
    uptime: string;
    bytesIn: number;
    bytesOut: number;
    /** Derived from the session's uptime; null when it can't be parsed. */
    onlineSince: string | null;
  } | null;

  voucher: {
    id: string;
    planName: string;
    /** Null for a generated code: nobody bought it through the platform. */
    customerEmail: string | null;
    status: string;
    purchasedAt: string;
    dataLimit: string | null;
    duration: string;
  } | null;

  payment: {
    amountKobo: number;
    reference: string;
    paidAt: string;
    status: string;
  } | null;

  /**
   * Every sale that has ever been put on this login, newest first.
   *
   * It exists because the fields above are deliberately the *current* ones
   * and a renewal replaces them. Showing only the latest would mean the
   * dialog quietly forgot the original purchase; showing only the original
   * is the bug this replaced. Both are true, so both are here.
   *
   * Not only renewals: a dead code revived onto a different plan is also a
   * sale on this login, and an owner looking at the row wants it.
   */
  history: HotspotUserPurchase[];
  /**
   * How many sales there are in total, and when the first was. Counted
   * before `history` is capped, so a long-lived login still reports the
   * truth about its first day.
   */
  purchaseCount: number;
  firstPurchasedAt: string | null;
}

export interface HotspotUserPurchase {
  voucherId: string;
  purchasedAt: string;
  planName: string;
  status: string;
  /** True when this sale topped up the one before it rather than starting fresh. */
  isRenewal: boolean;
  /** Null when no payment document references this voucher. */
  amountKobo: number | null;
  reference: string | null;
  /**
   * What the renewal discarded, when it discarded anything. Present only on
   * vouchers written after `Voucher.renewal` existed, and the only record
   * of a reset once the router has been rewritten.
   */
  renewal: {
    expiryMode: "extend" | "reset";
    dataMode: "carry" | "reset";
    previousExpiresAt: string | null;
    previousLimitBytes: number | null;
    previousBytesUsed: number | null;
  } | null;
}

/**
 * How far back the dialog lists. Ten is far more than anyone reads in a
 * support call, and the cap is what stops a year-old daily-plan login
 * costing a payment lookup per renewal.
 */
const HISTORY_LIMIT = 10;

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getHotspotUserDetail(
  tenantId: string,
  locationId: string,
  username: string
): Promise<HotspotUserDetail | null> {
  const resolved = await getRouterForLocation(tenantId, locationId);
  if (!resolved) return null;

  const [routerUser, activeSessions, vouchers] = await Promise.all([
    findHotspotUser(resolved.config, username),
    findActiveSessionsForUser(resolved.config, username),
    getTenantVouchersByLocation(tenantId, locationId),
  ]);

  // The live one, by the same rule the list behind this dialog uses. A
  // plain `find` here was unordered, so after a renewal it returned the
  // original purchase and every field below followed it - including the
  // payment, which is looked up by the voucher's own id.
  const voucher = liveVoucherFor(vouchers, username);

  // Every sale on this login, newest first. Already in memory: `vouchers`
  // is the whole location, fetched above for the router join.
  const chain = vouchers
    .filter((v) => v.username === username)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const listed = chain.slice(0, HISTORY_LIMIT);

  // One lookup per listed sale, in parallel. The live voucher's payment is
  // taken from the same set rather than fetched twice.
  const payments = await Promise.all(
    listed.map((v) => getTenantPaymentForVoucher(tenantId, v.id))
  );

  const payment = voucher
    ? payments[listed.findIndex((v) => v.id === voucher.id)] ??
      (await getTenantPaymentForVoucher(tenantId, voucher.id))
    : null;

  const history: HotspotUserPurchase[] = listed.map((v, index) => ({
    voucherId: v.id,
    purchasedAt: v.createdAt.toISOString(),
    planName: v.planName,
    status: v.status,
    isRenewal: Boolean(v.renewalOf),
    amountKobo: payments[index]?.amount ?? null,
    reference: payments[index]?.paystackReference ?? null,
    renewal: v.renewal
      ? {
          expiryMode: v.renewal.expiryMode,
          dataMode: v.renewal.dataMode,
          previousExpiresAt: v.renewal.previousExpiresAt?.toISOString() ?? null,
          previousLimitBytes: v.renewal.previousLimitBytes,
          previousBytesUsed: v.renewal.previousBytesUsed,
        }
      : null,
  }));

  const user = routerUser.success ? routerUser.data : null;
  const sessions = activeSessions.success ? activeSessions.data ?? [] : [];

  // The one shown in the session panel. Longest-running rather than
  // whichever the router listed first, so the "online since" a support call
  // is reading out is the moment this voucher came online, not the moment
  // its most recent device joined.
  const live =
    sessions.length === 0
      ? null
      : sessions.reduce((longest, candidate) =>
          (parseMikrotikDuration(candidate.uptime) ?? 0) >
          (parseMikrotikDuration(longest.uptime) ?? 0)
            ? candidate
            : longest
        );

  let onlineSince: string | null = null;
  if (live) {
    const seconds = parseMikrotikDuration(live.uptime);
    if (seconds !== null) {
      onlineSince = new Date(Date.now() - seconds * 1000).toISOString();
    }
  }

  // Lifetime counters plus every open session, per direction. A session's
  // bytes are not in the user record until it ends, so leaving them out
  // reports a user's first session as nothing used.
  const liveBytes = (field: "bytes-in" | "bytes-out"): number =>
    sessions.reduce((sum, s) => {
      const parsed = Number(s[field]);
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);

  const lifetimeIn = toNumber(user?.["bytes-in"]);
  const lifetimeOut = toNumber(user?.["bytes-out"]);

  return {
    username,
    foundOnRouter: user !== null,
    routerReachable: routerUser.success,
    routerError: routerUser.success ? null : routerUser.error ?? "Unknown error",
    routerName: resolved.routerName,
    locationName: resolved.locationName,

    password: user?.password ?? voucher?.password ?? null,
    profile: user?.profile ?? null,
    comment: user?.comment ?? null,
    disabled: user?.disabled === "true" || user?.disabled === "yes",

    limitUptime: user?.["limit-uptime"] ?? null,
    uptimeUsed: user?.uptime ?? null,
    // The router first, since that is what is actually enforced. The
    // voucher's own allowance is the fallback, so a user whose router
    // record carries no cap still reports the allowance that was sold
    // rather than claiming there is no limit at all.
    limitBytesTotal:
      toNumber(user?.["limit-bytes-total"]) ??
      parseDataLimitBytes(voucher?.dataLimit),
    bytesIn:
      lifetimeIn === null && sessions.length === 0
        ? null
        : (lifetimeIn ?? 0) + liveBytes("bytes-in"),
    bytesOut:
      lifetimeOut === null && sessions.length === 0
        ? null
        : (lifetimeOut ?? 0) + liveBytes("bytes-out"),
    bytesUsed: totalBytesUsed(user, sessions),

    sessionCount: sessions.length,

    expiresAt:
      voucher?.expiresAt?.toISOString() ??
      parseRouterExpiryComment(user?.comment)?.toISOString() ??
      null,

    session: live
      ? {
          address: live.address,
          macAddress: live["mac-address"],
          uptime: live.uptime,
          bytesIn: Number(live["bytes-in"] ?? 0),
          bytesOut: Number(live["bytes-out"] ?? 0),
          onlineSince,
        }
      : null,

    voucher: voucher
      ? {
          id: voucher.id,
          planName: voucher.planName,
          customerEmail: voucher.userEmail,
          status: voucher.status,
          purchasedAt: voucher.createdAt.toISOString(),
          dataLimit: voucher.dataLimit ?? null,
          duration: voucher.duration,
        }
      : null,

    payment: payment
      ? {
          amountKobo: payment.amount,
          reference: payment.paystackReference,
          paidAt: payment.createdAt.toISOString(),
          status: payment.status,
        }
      : null,

    history,
    purchaseCount: chain.length,
    firstPurchasedAt:
      chain.length > 0
        ? chain[chain.length - 1].createdAt.toISOString()
        : null,
  };
}
