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
 * Nigeria is the whole market here (prices in kobo, Paystack, `en-NG`
 * everywhere) and has no daylight saving, so a fixed zone is both correct
 * and stable. If this ever serves another country, this is the constant to
 * replace with a per-tenant value.
 *
 * Note this governs **display only**. Which payments count as "today" is a
 * separate question, still answered against the server's own midnight - see
 * `lib/firestore-helpers.ts`.
 */
export const DISPLAY_TIME_ZONE = "Africa/Lagos";

const toDateObject = (date: Date | { toDate?: () => Date }): Date =>
  date instanceof Date ? date : date.toDate?.() || new Date();

/** A date and time, e.g. "Oct 16, 2026, 11:29 AM". */
export function formatDate(date: Date | { toDate?: () => Date }): string {
  return toDateObject(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

/** Just the day, e.g. "16 Oct 2026". For anything with no useful time. */
export function formatDay(date: Date | { toDate?: () => Date }): string {
  return toDateObject(date).toLocaleDateString("en-GB", {
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

// Generate DiceBear avatar URL from email
export function getAvatarUrl(email?: string | null): string | undefined {
  if (!email) return undefined;
  return `https://api.dicebear.com/10.x/dylan/svg?seed=${encodeURIComponent(email)}&backgroundColor=f4f4f5&hairColor=ff2e88,00e5ff,7cff00,ffe600,b400ff`;
}

// Generate DiceBear brand icon URL from brand name
export function getBrandIconUrl(brandName: string): string {
  return `https://api.dicebear.com/10.x/shapes/svg?seed=${encodeURIComponent(brandName)}&tags=animation`;
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
