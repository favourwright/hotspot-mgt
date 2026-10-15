export { cn } from "cn";

// Format kobo to Naira string
export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Format Date or Firestore Timestamp to readable date
export function formatDate(date: Date | { toDate?: () => Date }): string {
  const dateObj = date instanceof Date ? date : date.toDate?.() || new Date();
  return dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
