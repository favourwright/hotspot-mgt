import {
  listHotspotUsers,
  profileSweepIntervalMinutes,
  HotspotUser,
} from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";
import {
  getTenantPlans,
  getTenantVouchersByLocation,
} from "@/lib/firestore-helpers";
import { Plan, Voucher } from "@/types/schemas";

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

/** Where a row's expiry date came from, since the two sources differ. */
export type ExpirySource = "platform" | "router-comment" | null;

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
  /** Connected time consumed so far, as the router reports it. */
  uptimeUsed: string | null;
  /**
   * Created by the platform, per the comment marker - true even when no
   * voucher matched, which is what distinguishes "no expiry date exists"
   * from "this plan simply has not started yet".
   */
  platformManaged: boolean;
  disabledOnRouter: boolean;
  // Platform side - null for users the platform never sold.
  voucherId: string | null;
  planName: string | null;
  customerEmail: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  expirySource: ExpirySource;
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

const ROUTER_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Reads the expiry date a router-created user carries in its comment field.
 *
 * Two conventions exist in the wild and both are handled:
 *
 * 1. `expires:YYYY-MM-DD` embedded anywhere in the comment. This is what the
 *    scheduler actually deployed on routers looks for - it finds the token,
 *    takes the 10 characters after it, and compares them to the clock as a
 *    *string*, which is why the date has to be zero-padded ISO.
 * 2. The whole comment being a timestamp, which is what
 *    pushProfileExpiryScript in lib/mikrotik.ts writes and reads via
 *    :totime. Accepts both RouterOS date formats.
 *
 * Comments are free text that people edit by hand, so anything else returns
 * null and the row simply shows no expiry. Never throws.
 */
export function parseRouterExpiryComment(
  comment: string | null | undefined
): Date | null {
  if (!comment) return null;

  // Convention 1 - mirror the router's own extraction exactly: the 10
  // characters following the token, no trimming. A comment like
  // "expires: 2026-10-04" (note the space) is malformed to the router too,
  // so refusing to read it here keeps the page honest about what will
  // actually be enforced.
  const token = "expires:";
  const at = comment.indexOf(token);
  if (at !== -1) {
    const slice = comment.slice(at + token.length, at + token.length + 10);
    return parseIsoDay(slice);
  }

  const text = comment.trim();
  if (text.length <= 10) return null;
  if (text.slice(0, 2).toLowerCase() === "vc") return null;

  // Convention 2, RouterOS 7: "2026-10-04 15:30:00"
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (iso) {
    return buildDate(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      iso[4], iso[5], iso[6]
    );
  }

  // Convention 2, RouterOS 6: "oct/04/2026 15:30:00"
  const legacy =
    /^([a-zA-Z]{3})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (legacy) {
    const month = ROUTER_MONTHS[legacy[1].toLowerCase()];
    if (month === undefined) return null;
    return buildDate(
      Number(legacy[3]),
      month,
      Number(legacy[2]),
      legacy[4], legacy[5], legacy[6]
    );
  }

  return null;
}

/**
 * A bare `YYYY-MM-DD` from an `expires:` comment, resolved to the END of
 * that day.
 *
 * The router blocks a user only when `$expiry < $today` as strings, so on
 * the expiry date itself they are still allowed through. Treating the date
 * as midnight would mark them expired here a full day before the router
 * does.
 */
function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = buildDate(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  if (!date) return null;

  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * Which of the comment conventions above a given comment is written in.
 *
 * Needed because renewing a voucher means writing a new expiry back into a
 * comment that is already there, and the router has to keep being able to
 * read it. Which format is in use depends on the RouterOS version that
 * wrote it - v6's scheduler reports `oct/04 15:30:00` and v7's reports
 * `2026-10-04 15:30:00` - so the only safe answer is to write back in
 * whatever style we found.
 */
export type RouterExpiryStyle = "token" | "iso" | "legacy";

export function routerExpiryCommentStyle(
  comment: string | null | undefined
): RouterExpiryStyle | null {
  if (!comment) return null;
  if (comment.includes("expires:")) return "token";

  const text = comment.trim();
  if (text.length <= 10) return null;
  if (text.slice(0, 2).toLowerCase() === "vc") return null;

  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)) {
    return "iso";
  }
  if (
    /^[a-zA-Z]{3}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)
  ) {
    return "legacy";
  }

  return null;
}

const ROUTER_MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * The comment a user *we* create gets, when there is no existing comment to
 * take a format from.
 *
 * ISO, because that is what the router's own `on-login` script writes on
 * RouterOS 7 and therefore what every platform-sold user on these routers
 * already carries. Deliberately separate from `formatRouterExpiryComment`,
 * which returns null for a comment in no recognised format and must keep
 * doing so: there, an unreadable comment means "do not touch this user".
 * Here there is no previous comment to misread.
 *
 * Rendered in the server's own timezone, which is also how
 * `parseRouterExpiryComment` reads one back. The pair is symmetric, so a
 * date that came off a router comment and goes back into one survives the
 * round trip whatever either clock thinks (see `extendVoucher`).
 */
export function routerExpiryComment(expiresAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-` +
    `${pad(expiresAt.getDate())} ${pad(expiresAt.getHours())}:` +
    `${pad(expiresAt.getMinutes())}:${pad(expiresAt.getSeconds())}`
  );
}

/**
 * Renders a new expiry into the comment format the router is already using.
 *
 * `previous` is the comment being replaced, and it matters for exactly one
 * style: `expires:` embeds the date inside free text the tenant may have
 * written around it, and the router finds it by looking at the ten
 * characters after the token. So that one is a surgical splice rather than a
 * rewrite, and the rest of the comment is left exactly as it was.
 *
 * Returns null for a comment in no recognised format. The caller must then
 * leave it alone: a comment we cannot read is one we cannot safely rewrite,
 * and guessing would hand the router a date its own script silently fails to
 * parse, which expires nobody and looks like nothing at all.
 */
export function formatRouterExpiryComment(
  expiresAt: Date,
  previous: string | null | undefined
): string | null {
  const style = routerExpiryCommentStyle(previous);
  if (!style) return null;

  const year = expiresAt.getFullYear();
  const month = expiresAt.getMonth();
  const day = String(expiresAt.getDate()).padStart(2, "0");
  const time = [
    expiresAt.getHours(),
    expiresAt.getMinutes(),
    expiresAt.getSeconds(),
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  if (style === "token") {
    const token = "expires:";
    const at = previous!.indexOf(token);
    const start = at + token.length;
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${day}`;
    return previous!.slice(0, start) + iso + previous!.slice(start + 10);
  }

  if (style === "iso") {
    return routerExpiryComment(expiresAt);
  }

  return `${ROUTER_MONTH_NAMES[month]}/${day}/${year} ${time}`;
}

function buildDate(
  year: number,
  monthIndex: number,
  day: number,
  hour?: string,
  minute?: string,
  second?: string
): Date | null {
  const date = new Date(
    year,
    monthIndex,
    day,
    hour ? Number(hour) : 0,
    minute ? Number(minute) : 0,
    second ? Number(second) : 0
  );

  if (Number.isNaN(date.getTime())) return null;
  // Reject values JavaScript silently rolls over, e.g. a 31st of February.
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return null;
  }
  return date;
}

function isTrue(value: string | undefined): boolean {
  return value === "true" || value === "yes";
}

/**
 * Longest a voucher may sit past its expiry, still enabled on the router,
 * before that counts as the router failing to enforce rather than the
 * router simply not having looked yet.
 *
 * Expiry is not enforced the moment it falls due. The platform closes a
 * voucher out within minutes (the `voucher-expiry` cron runs every 10), but
 * the router clamps `limit-uptime` only when its per-profile sweeper next
 * fires, and for any plan of 12 hours or more that is hourly. Between those
 * two moments the two sides disagree, correctly, about a voucher that is
 * behaving exactly as designed.
 *
 * Reported as drift, that window produced "N users need attention" on every
 * single daily-plan expiry - three at once on 2026-10-15, cleared by itself
 * an hour later, with nothing wrong on either side. So the allowance is the
 * profile's own sweep interval, read from the same function that configured
 * the scheduler, plus a small margin for the sweep's own run time and for
 * the router's clock not being ours to the second.
 *
 * A plan we cannot find falls back to the longest interval any profile
 * uses. Staying quiet for an extra hour about a real enforcement failure is
 * cheap; crying drift on a healthy expiry is what this is fixing.
 */
const SWEEP_MARGIN_MS = 5 * 60 * 1000;
const MAX_SWEEP_INTERVAL_MINUTES = 60;

export function routerSweepGraceMs(
  plan: Pick<Plan, "routerDurationValue" | "routerDurationUnit"> | null
): number {
  const minutes = plan
    ? profileSweepIntervalMinutes(
        plan.routerDurationValue,
        plan.routerDurationUnit
      )
    : MAX_SWEEP_INTERVAL_MINUTES;

  return minutes * 60 * 1000 + SWEEP_MARGIN_MS;
}

export function buildRow(
  routerUser: HotspotUser | null,
  voucher: Voucher | null,
  now: Date,
  plan: Pick<Plan, "routerDurationValue" | "routerDurationUnit"> | null = null
): MergedHotspotUser {
  const onRouter = routerUser !== null;
  const disabledOnRouter = isTrue(routerUser?.disabled);
  const limitUptime = routerUser?.["limit-uptime"] ?? null;
  const expiredOnRouter = limitUptime === ROUTER_EXPIRED_MARKER;

  // A router-created user carries its expiry in the comment; a sold voucher
  // carries one in Firestore. Prefer the platform's when both exist, since
  // that is the one the customer was sold.
  const commentExpiry = parseRouterExpiryComment(routerUser?.comment);
  const expiresAt = voucher?.expiresAt ?? commentExpiry;
  const expirySource: ExpirySource = voucher?.expiresAt
    ? "platform"
    : commentExpiry
      ? "router-comment"
      : null;

  const expiredByDate = Boolean(expiresAt && expiresAt.getTime() < now.getTime());
  /** How long ago it fell due, which is what the grace window is measured against. */
  const pastDueMs = expiresAt ? now.getTime() - expiresAt.getTime() : 0;

  let status: UserStatus;
  if (!onRouter) {
    status = "missing-on-router";
  } else if (expiredOnRouter || expiredByDate || voucher?.status === "expired") {
    status = "expired";
  } else if (disabledOnRouter) {
    status = "disabled";
  } else {
    status = "active";
  }

  let drift: string | null = null;
  if (voucher && !onRouter) {
    drift = "Sold through the platform but missing on the router";
  } else if (
    // Only flagged for sold vouchers. A router-created user whose comment
    // date has just passed is the normal case between the expiry script's
    // scheduled runs, not a problem worth warning about.
    //
    // The same is true of a *sold* voucher for the first sweep interval
    // after it falls due, which is what the grace window below is for. Our
    // close-out runs every 10 minutes and the router's sweeper hourly, so
    // without it every daily-plan expiry spends up to an hour reported as a
    // disagreement between two sides that are both working.
    expirySource === "platform" &&
    expiredByDate &&
    pastDueMs > routerSweepGraceMs(plan) &&
    onRouter &&
    !expiredOnRouter &&
    !disabledOnRouter
  ) {
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
    uptimeUsed: routerUser?.uptime ?? null,
    platformManaged:
      routerUser?.comment?.slice(0, 2).toLowerCase() === "vc" || voucher !== null,
    disabledOnRouter,
    voucherId: voucher?.id ?? null,
    planName: voucher?.planName ?? null,
    customerEmail: voucher?.userEmail ?? null,
    purchasedAt: voucher?.createdAt.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    expirySource,
    voucherStatus: voucher?.status ?? null,
  };
}

/**
 * Groups the tenant's vouchers by the username they put on the router.
 *
 * One username can now belong to several voucher documents, because a
 * renewal tops up the credential the customer already has rather than
 * issuing another one (lib/voucher-renewal.ts). Only one of them is the
 * live row, and `new Map(vouchers.map(...))` would pick whichever Firestore
 * happened to return last - so the newest wins explicitly, and every
 * superseded document is dropped before it can be mistaken for a sale the
 * router has lost track of.
 *
 * Superseded rows are left out rather than shown, for the same reason
 * archived ones are: this is the reconciliation view, and the sale is still
 * counted everywhere that counts sales.
 */
function indexVouchersByUsername(vouchers: Voucher[]): Map<string, Voucher> {
  const byUsername = new Map<string, Voucher>();

  for (const voucher of vouchers) {
    if (voucher.status === "superseded") continue;

    const held = byUsername.get(voucher.username);
    if (!held || voucher.createdAt.getTime() > held.createdAt.getTime()) {
      byUsername.set(voucher.username, voucher);
    }
  }

  return byUsername;
}

/**
 * The one voucher that is the live row for a username, by the same rule
 * `indexVouchersByUsername` applies above: superseded documents are not it,
 * and of the rest the newest wins.
 *
 * Exported because the detail dialog needs the same answer for one user and
 * used to work it out with `vouchers.find(v => v.username === username)`.
 * That query is unordered, so after a renewal it returned whichever
 * document Firestore happened to hand back first - in practice the original
 * purchase, which is why the dialog showed the first purchase date and,
 * worse, the *first* payment's amount and reference next to a plan that had
 * been renewed since.
 */
export function liveVoucherFor(
  vouchers: Voucher[],
  username: string
): Voucher | null {
  let live: Voucher | null = null;

  for (const voucher of vouchers) {
    if (voucher.username !== username) continue;
    if (voucher.status === "superseded") continue;
    if (!live || voucher.createdAt.getTime() > live.createdAt.getTime()) {
      live = voucher;
    }
  }

  return live;
}

export async function getMergedHotspotUsers(
  tenantId: string,
  locationId: string
): Promise<HotspotUsersResult | null> {
  const resolved = await getRouterForLocation(tenantId, locationId);
  if (!resolved) return null;

  // The router call is the one that can hang or fail, so it must never stop
  // the platform half from being shown.
  // The plans come along for one reason: how long the router is allowed to
  // take before a still-enabled expired voucher counts as drift depends on
  // that plan's profile sweep interval. See `routerSweepGraceMs`.
  const [routerResult, vouchers, plans] = await Promise.all([
    listHotspotUsers(resolved.config),
    getTenantVouchersByLocation(tenantId, locationId),
    getTenantPlans(tenantId, locationId),
  ]);

  const now = new Date();
  const vouchersByUsername = indexVouchersByUsername(vouchers);
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const planFor = (voucher: Voucher | null) =>
    voucher ? plansById.get(voucher.planId) ?? null : null;
  const users: MergedHotspotUser[] = [];

  if (routerResult.success && routerResult.data) {
    for (const routerUser of routerResult.data) {
      const voucher = vouchersByUsername.get(routerUser.name) ?? null;
      if (voucher) vouchersByUsername.delete(routerUser.name);
      users.push(buildRow(routerUser, voucher, now, planFor(voucher)));
    }
  }

  // Whatever is left was sold but has no counterpart on the router. When the
  // router is unreachable these are all we can show, and they are listed as
  // platform rows rather than claimed to be missing.
  for (const voucher of vouchersByUsername.values()) {
    // Except the ones the reaper took on purpose. They are missing from the
    // router because this app deleted them, months after they expired, and
    // listing them as unaccounted-for drift would recreate exactly the
    // growing warning the reaper exists to clear.
    if (voucher.routerUserReapedAt) continue;

    const row = buildRow(null, voucher, now, planFor(voucher));
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
