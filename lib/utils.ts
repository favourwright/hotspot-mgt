export { cn } from "cn";

// Format kobo to Naira string
export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The timezone every date in this app is displayed in.
 *
 * Pinned rather than left to the runtime because the same timestamp was
 * being rendered by two different machines: the VPS runs `Etc/UTC`, browsers
 * run whatever the viewer has, and Nigeria is UTC+1 - so a payment shown as
 * 10:00 on a server-rendered dashboard was 11:00 on the client-rendered
 * transactions page. One timestamp, two answers, an hour apart.
 *
 * Nigeria is the whole market here (prices in kobo, Monnify, `en-NG`
 * everywhere) and has no daylight saving, so a fixed zone is both correct
 * and stable. If this ever serves another country, this is the constant to
 * replace with a per-tenant value.
 *
 * Note this governs **display only**. Which payments count as "today" is a
 * separate question, still answered against the server's own midnight - see
 * `lib/firestore-helpers.ts`.
 */
export const DISPLAY_TIME_ZONE = "Africa/Lagos";

/** Anything a date reaches these formatters as. */
export type DateLike = Date | string | number | { toDate?: () => Date };

/**
 * Coerce whatever arrived into a Date, or null if it is not a date at all.
 *
 * The string case is the one that matters. A server component hands a client
 * component a real `Date`, but the same row fetched through an API route has
 * been through JSON and arrives as an ISO string - so a list that renders
 * correctly on first paint can be wrong the moment it refetches.
 *
 * Null rather than `new Date()` for unparseable input. The previous fallback
 * meant a value this function did not understand was rendered as the current
 * time: every row in a table showing today, identically, with nothing
 * indicating the dates were invented.
 */
function toDateObject(date: DateLike | null | undefined): Date | null {
  if (date === null || date === undefined) return null;
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? null : date;

  if (typeof date === "string" || typeof date === "number") {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // A Firestore Timestamp, which only the server ever holds.
  const converted = date.toDate?.();
  return converted instanceof Date && !Number.isNaN(converted.getTime())
    ? converted
    : null;
}

/** A date and time, e.g. "Oct 16, 2026, 11:29 AM". */
export function formatDate(date: DateLike | null | undefined): string {
  const value = toDateObject(date);
  if (!value) return "-";

  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

/** Just the day, e.g. "16 Oct 2026". For anything with no useful time. */
export function formatDay(date: DateLike | null | undefined): string {
  const value = toDateObject(date);
  if (!value) return "-";

  return value.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

// Calculate expiry date from createdAt + duration string
export function calculateExpiry(createdAt: Date, duration: string): Date {
  const date = new Date(createdAt);
  const match = duration.match(/(\d+)\s*(hour|day|week|month)s?/i);

  if (!match) return date;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "hour":
      date.setHours(date.getHours() + value);
      break;
    case "day":
      date.setDate(date.getDate() + value);
      break;
    case "week":
      date.setDate(date.getDate() + value * 7);
      break;
    case "month":
      date.setMonth(date.getMonth() + value);
      break;
  }

  return date;
}

// Truncate string with ellipsis
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

// Generate random alphanumeric string
export function randomAlphanumeric(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * A generated avatar for a user, served from our own origin.
 *
 * **Seeded on the account id, never on the email.** Two separate reasons,
 * and both were real:
 *
 * - An email in the seed is an email in a URL. These used to be fetched
 *   straight from a third-party host, so every authenticated page view
 *   handed that host an address, an IP and a `Referer` naming the tenant
 *   subdomain. The request is now first-party (`/api/avatar/...`), but
 *   the id is still the right seed: our own access logs should not be
 *   full of addresses either.
 * - An email can be changed. Seeded on one, somebody's avatar changes the
 *   day they update their address, for no reason they would understand.
 *   An account id never changes.
 */
export function getAvatarUrl(uid?: string | null): string | undefined {
  if (!uid) return undefined;
  return `/api/avatar/dylan?seed=${encodeURIComponent(uid)}`;
}

/** A generated brand icon. Same route, a different style. */
export function getBrandIconUrl(brandName: string): string {
  return `/api/avatar/shapes?seed=${encodeURIComponent(brandName)}`;
}

/**
 * A plan's `sharedUsers` (a mirror of the MikroTik profile's `shared-users`)
 * as a bare value: "3", "Unlimited". For somewhere already labelled
 * "Devices", like a table column or an email row.
 *
 * Returns null for anything we cannot state as a fact - absent on plans
 * created before the value was captured, and non-numeric for a router value
 * we do not recognise. Callers show nothing rather than guessing, because
 * the number is part of what the customer is paying for.
 */
export function formatDeviceCount(
  sharedUsers: string | null | undefined
): string | null {
  if (!sharedUsers) return null;

  const value = sharedUsers.trim().toLowerCase();
  if (value === "unlimited") return "Unlimited";

  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) return null;

  return String(count);
}

/**
 * The same value as its own phrase - "1 device", "3 devices", "Unlimited
 * devices" - for a chip or a line of copy carrying no label of its own.
 */
export function formatDeviceLimit(
  sharedUsers: string | null | undefined
): string | null {
  const count = formatDeviceCount(sharedUsers);
  if (count === null) return null;

  return count === "1" ? "1 device" : `${count} devices`;
}

/**
 * What is happening to a tenant's plan fee, in one phrase.
 *
 * Derived from the resolved amount rather than the discount's type and
 * value, because the amount is what was actually applied and is the only
 * figure every surface already carries. A discount that covers the whole fee
 * is "waived" rather than "100% off": that is the word used everywhere else,
 * and arithmetic reads as a calculation where a word reads as a fact.
 *
 * Client-safe, unlike `lib/fee-waivers.ts`, which reaches Firestore.
 */
export function describeFeeDiscount(
  monthlyFeeKobo: number,
  discountKobo: number
): { full: boolean; label: string; payableKobo: number } {
  const applied = Math.min(Math.max(discountKobo, 0), monthlyFeeKobo);
  const full = applied >= monthlyFeeKobo && monthlyFeeKobo > 0;

  return {
    full,
    label: full ? "waived" : `${formatNaira(applied)} off`,
    payableKobo: monthlyFeeKobo - applied,
  };
}

/**
 * How far ahead of UTC the display zone is at a given instant.
 *
 * Done by formatting the same instant twice rather than with a table, so it
 * stays correct if the zone is ever changed to one that observes daylight
 * saving. Nigeria does not, so today this is always one hour.
 */
function displayZoneOffsetMs(at: Date): number {
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(
    at.toLocaleString("en-US", { timeZone: DISPLAY_TIME_ZONE })
  );
  return local.getTime() - utc.getTime();
}

/**
 * Midnight today, in the zone the business actually operates in.
 *
 * `new Date(); d.setHours(0,0,0,0)` gives midnight in whatever zone the
 * *process* runs in, which on the VPS is UTC - so "today's revenue" started
 * at 01:00 Lagos time and ran to 01:00 the next day. Everyone reading the
 * number is in Lagos; the server is the only thing that is not.
 */
export function startOfTodayInDisplayZone(reference: Date = new Date()): Date {
  return startOfDisplayZoneDay(reference, false);
}

/** Midnight on the first of this month, in the display zone. See above. */
export function startOfMonthInDisplayZone(reference: Date = new Date()): Date {
  return startOfDisplayZoneDay(reference, true);
}

function startOfDisplayZoneDay(reference: Date, firstOfMonth: boolean): Date {
  // en-CA formats as YYYY-MM-DD, which is the one locale that parses back
  // without ambiguity.
  const [year, month, today] = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(reference)
    .split("-")
    .map(Number);

  const midnightAsUtc = Date.UTC(year, month - 1, firstOfMonth ? 1 : today);
  return new Date(midnightAsUtc - displayZoneOffsetMs(new Date(midnightAsUtc)));
}
