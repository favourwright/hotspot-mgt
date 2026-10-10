import {
  findActiveSessionForUser,
  findHotspotUser,
  parseMikrotikDuration,
} from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";
import {
  getTenantVouchersByLocation,
  getTenantPaymentForVoucher,
} from "@/lib/firestore-helpers";
import { parseRouterExpiryComment } from "@/lib/hotspot-users";
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
  /** Data allowance and consumption, in bytes. */
  limitBytesTotal: number | null;
  bytesIn: number | null;
  bytesOut: number | null;

  expiresAt: string | null;

  /** Live session, when connected right now. */
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
    customerEmail: string;
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
}

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

  const [routerUser, session, vouchers] = await Promise.all([
    findHotspotUser(resolved.config, username),
    findActiveSessionForUser(resolved.config, username),
    getTenantVouchersByLocation(tenantId, locationId),
  ]);

  const voucher = vouchers.find((v) => v.username === username) ?? null;
  const payment = voucher
    ? await getTenantPaymentForVoucher(tenantId, voucher.id)
    : null;

  const user = routerUser.success ? routerUser.data : null;
  const live = session.success ? session.data : null;

  let onlineSince: string | null = null;
  if (live) {
    const seconds = parseMikrotikDuration(live.uptime);
    if (seconds !== null) {
      onlineSince = new Date(Date.now() - seconds * 1000).toISOString();
    }
  }

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
    bytesIn: toNumber(user?.["bytes-in"]),
    bytesOut: toNumber(user?.["bytes-out"]),

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
  };
}
