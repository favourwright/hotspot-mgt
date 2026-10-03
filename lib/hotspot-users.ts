import { listHotspotUsers, HotspotUser } from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";
import { getTenantVouchersByLocation } from "@/lib/firestore-helpers";
import { Voucher } from "@/types/schemas";

/**
 * Joins what the platform sold with what the router actually has.
 *
 * Neither side is complete on its own. Firestore knows who paid, for which
 * plan, and when it should expire. The router knows which users exist at
 * all - including ones created by hand in Winbox years before this app -
 * and how expiry is really being enforced.
 *
 * The join key is the username, which is the voucher code. Platform-created
 * users also carry `comment: "vc"` (see app/api/payment/verify/route.ts),
 * giving a second, independent signal.
 *
 * Where the two disagree is the point: those mismatches are what a tenant
 * needs to see, so they are surfaced as `drift` rather than hidden behind a
 * single reconciled status.
 */

export type UserSource = "platform" | "router";

export type UserStatus =
  | "active"
  | "expired"
  | "disabled"
  | "missing-on-router";

export interface MergedHotspotUser {
  username: string;
  source: UserSource;
  status: UserStatus;
  /** Human-readable mismatch between the two sources, or null when they agree. */
  drift: string | null;
  onRouter: boolean;
  profile: string | null;
  comment: string | null;
  limitUptime: string | null;
  limitBytesTotal: string | null;
  disabledOnRouter: boolean;
  // Platform side - null for users the platform never sold.
  voucherId: string | null;
  planName: string | null;
  customerEmail: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  voucherStatus: string | null;
}

export interface HotspotUsersResult {
  users: MergedHotspotUser[];
  /** False when the router could not be reached; platform rows are still returned. */
  routerReachable: boolean;
  routerError: string | null;
  locationName: string;
  routerName: string;
  counts: {
    total: number;
    platform: number;
    routerOnly: number;
    needsAttention: number;
  };
}

/**
 * The on-router expiry script marks a user as finished by clamping
 * limit-uptime to 1s (lib/mikrotik.ts, pushProfileExpiryScript). Treating
 * that as "expired" is what lets the router's verdict override the
 * platform's optimistic expiresAt.
 */
const ROUTER_EXPIRED_MARKER = "1s";

function isTrue(value: string | undefined): boolean {
  return value === "true" || value === "yes";
}

function buildRow(
  routerUser: HotspotUser | null,
  voucher: Voucher | null,
  now: Date
): MergedHotspotUser {
  const onRouter = routerUser !== null;
  const disabledOnRouter = isTrue(routerUser?.disabled);
  const limitUptime = routerUser?.["limit-uptime"] ?? null;
  const expiredOnRouter = limitUptime === ROUTER_EXPIRED_MARKER;
  const expiredOnPlatform = Boolean(
    voucher?.expiresAt && voucher.expiresAt.getTime() < now.getTime()
  );

  let status: UserStatus;
  if (!onRouter) {
    status = "missing-on-router";
  } else if (expiredOnRouter || expiredOnPlatform || voucher?.status === "expired") {
    status = "expired";
  } else if (disabledOnRouter) {
    status = "disabled";
  } else {
    status = "active";
  }

  let drift: string | null = null;
  if (voucher && !onRouter) {
    drift = "Sold through the platform but missing on the router";
  } else if (expiredOnPlatform && onRouter && !expiredOnRouter && !disabledOnRouter) {
    drift = "Past its expiry date but still enabled on the router";
  } else if (expiredOnRouter && voucher && voucher.status === "active") {
    drift = "Expired on the router while the platform still lists it as active";
  }

  return {
    username: routerUser?.name ?? voucher?.username ?? "",
    source: voucher ? "platform" : "router",
    status,
    drift,
    onRouter,
    profile: routerUser?.profile ?? null,
    comment: routerUser?.comment ?? null,
    limitUptime,
    limitBytesTotal: routerUser?.["limit-bytes-total"] ?? null,
    disabledOnRouter,
    voucherId: voucher?.id ?? null,
    planName: voucher?.planName ?? null,
    customerEmail: voucher?.userEmail ?? null,
    purchasedAt: voucher?.createdAt.toISOString() ?? null,
    expiresAt: voucher?.expiresAt?.toISOString() ?? null,
    voucherStatus: voucher?.status ?? null,
  };
}

export async function getMergedHotspotUsers(
  tenantId: string,
  locationId: string
): Promise<HotspotUsersResult | null> {
  const resolved = await getRouterForLocation(tenantId, locationId);
  if (!resolved) return null;

  // The router call is the one that can hang or fail, so it must never stop
  // the platform half from being shown.
  const [routerResult, vouchers] = await Promise.all([
    listHotspotUsers(resolved.config),
    getTenantVouchersByLocation(tenantId, locationId),
  ]);

  const now = new Date();
  const vouchersByUsername = new Map(vouchers.map((v) => [v.username, v]));
  const users: MergedHotspotUser[] = [];

  if (routerResult.success && routerResult.data) {
    for (const routerUser of routerResult.data) {
      const voucher = vouchersByUsername.get(routerUser.name) ?? null;
      if (voucher) vouchersByUsername.delete(routerUser.name);
      users.push(buildRow(routerUser, voucher, now));
    }
  }

  // Whatever is left was sold but has no counterpart on the router. When the
  // router is unreachable these are all we can show, and they are listed as
  // platform rows rather than claimed to be missing.
  for (const voucher of vouchersByUsername.values()) {
    const row = buildRow(null, voucher, now);
    if (!routerResult.success) {
      row.status = "active";
      row.drift = null;
    }
    users.push(row);
  }

  users.sort((a, b) => a.username.localeCompare(b.username));

  return {
    users,
    routerReachable: routerResult.success,
    routerError: routerResult.success ? null : routerResult.error ?? "Unknown error",
    locationName: resolved.locationName,
    routerName: resolved.routerName,
    counts: {
      total: users.length,
      platform: users.filter((u) => u.source === "platform").length,
      routerOnly: users.filter((u) => u.source === "router").length,
      needsAttention: users.filter((u) => u.drift !== null).length,
    },
  };
}
