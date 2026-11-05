/**
 * The RouterOS source this app installs to clamp expired hotspot users, and
 * the recognisers for the global checker it used to install.
 *
 * No imports on purpose: `npm run test:expiry-scripts` exercises this file
 * directly, with no Firebase and no router.
 *
 * Two things went wrong with the sweep, both reported as router CPU load and
 * a log full of `hotspot user ... changed by scheduler:voucher-expiry-check`:
 *
 * 1. **It re-clamped users that were already clamped.** Every sweep ran
 *    `set limit-uptime=1s` on every expired user, forever, until
 *    `voucher-reap` deleted them. Each one is a config write and a log line.
 *    The sweep now reads `limit-uptime` first and writes only when it is not
 *    already `1s`, so a sweep writes only for a user who has just expired.
 *
 * 2. **The global checker was never removed.** Before 2026-09-24 the app
 *    installed one scheduler, `voucher-expiry-check`, running the script
 *    `check-voucher-expiry` over *every* hotspot user on the router, hourly.
 *    Commit dbe9917 replaced it with one scheduler per profile and never
 *    deleted the old one, so every router set up before then runs both.
 *    The oldest two versions of that script disable users outright instead
 *    of clamping them.
 *
 * The legacy script is deleted only when its source is, word for word, one
 * of the three versions this app shipped. A script with that name and any
 * other body is the tenant's own, and is left alone.
 */

export const LEGACY_EXPIRY_SCHEDULER_NAME = "voucher-expiry-check";
export const LEGACY_EXPIRY_SCRIPT_NAME = "check-voucher-expiry";

/** RouterOS reads a `limit-uptime` of 1s back as either of these. */
export const CLAMPED_UPTIME_VALUES = ["00:00:01", "1s"] as const;

/** Profile name as it appears in our script and scheduler names. */
function sanitizeProfileName(profileName: string): string {
  return profileName.replace(/\s+/g, "-").toLowerCase();
}

export function profileExpiryScriptName(profileName: string): string {
  return `vc-check-${sanitizeProfileName(profileName)}`;
}

export function profileExpirySchedulerName(profileName: string): string {
  return `vc-sched-${sanitizeProfileName(profileName)}`;
}

/** True when an installed sweeper body is already the current one. */
export function isCurrentProfileExpiryScript(
  profileName: string,
  installed: string | undefined
): boolean {
  if (!installed) return false;
  return normaliseSource(installed) === normaliseSource(profileExpiryScriptSource(profileName));
}

/** Escapes a value for a double-quoted RouterOS string literal. */
function routerString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

/**
 * The per-profile sweeper (`vc-check-<profile>`).
 *
 * The clock is read once per sweep rather than once per user, and a user
 * whose `limit-uptime` is already the clamp value is skipped before its
 * comment is even parsed. A user whose clamp was cleared (a renewal writes
 * `limit-uptime=0`) is not `1s`, so it is still clamped again if its comment
 * says it has expired - the same outcome as before, minus the repeat writes.
 */
export function profileExpiryScriptSource(profileName: string): string {
  const profile = routerString(profileName);
  return `:local nowDate [/system clock get date]
:local nowClock [/system clock get time]
:local nowStr ("$nowDate $nowClock")
:local nowTime [:totime $nowStr]
:foreach u in=[/ip hotspot user find profile="${profile}"] do={
  :local lu [:tostr [/ip hotspot user get $u limit-uptime]]
  :if ($lu != "${CLAMPED_UPTIME_VALUES[0]}" and $lu != "${CLAMPED_UPTIME_VALUES[1]}") do={
    :local comment [/ip hotspot user get $u comment]
    :local ucode [:pick $comment 0 2]
    :if ([:len $comment] > 10 and $ucode != "vc") do={
      :local expTime [:totime $comment]
      :if ($nowTime > $expTime) do={
        /ip hotspot user set limit-uptime=1s $u
      }
    }
  }
}`;
}

/**
 * Every body the global `check-voucher-expiry` script ever shipped with,
 * copied from git history (704e1bc, 75b3c6d, 8ce68ab/dbe9917~1).
 */
const LEGACY_EXPIRY_SCRIPT_SOURCES = [
  `:foreach u in=[/ip hotspot user find] do={
  :local comment [/ip hotspot user get $u comment]
  :if ([:len $comment] > 10) do={
    :if ($comment != "vc") do={
      :local now [/system clock get date]
      :local nowtime [/system clock get time]
      :local expdate [:pick $comment 0 11]
      :local exptime [:pick $comment 12 21]
      :if ($now > $expdate) do={
        /ip hotspot user disable $u
      } else={
        :if ($now = $expdate and $nowtime >= $exptime) do={
          /ip hotspot user disable $u
        }
      }
    }
  }
}`,
  `:foreach u in=[/ip hotspot user find] do={
  :local comment [/ip hotspot user get $u comment]
  :local ucode [:pick $comment 0 2]
  :if ([:len $comment] > 10 and $ucode != "vc") do={
    :local expStr $comment
    :local expTime [:totime $expStr]
    :local nowDate [/system clock get date]
    :local nowTime [/system clock get time]
    :local nowStr ("$nowDate $nowTime")
    :local nowTime [:totime $nowStr]
    :if ($nowTime > $expTime) do={
      /ip hotspot user disable $u
    }
  }
}`,
  `:foreach u in=[/ip hotspot user find] do={
  :local comment [/ip hotspot user get $u comment]
  :local ucode [:pick $comment 0 2]
  :if ([:len $comment] > 10 and $ucode != "vc") do={
    :local expStr $comment
    :local expTime [:totime $expStr]
    :local nowDate [/system clock get date]
    :local nowTime [/system clock get time]
    :local nowStr ("$nowDate $nowTime")
    :local nowTime [:totime $nowStr]
    :if ($nowTime > $expTime) do={
      /ip hotspot user set limit-uptime=1s $u
    }
  }
}`,
];

/** Whitespace-insensitive: RouterOS may store `\r\n` and re-indent. */
function normaliseSource(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

const LEGACY_NORMALISED = new Set(LEGACY_EXPIRY_SCRIPT_SOURCES.map(normaliseSource));

/** True only for a script body this app itself installed. */
export function isOurLegacyExpiryScript(source: string | undefined): boolean {
  if (!source) return false;
  return LEGACY_NORMALISED.has(normaliseSource(source));
}

/** True only for the scheduler this app installed to run that script. */
export function isOurLegacyExpiryScheduler(onEvent: string | undefined): boolean {
  return (onEvent ?? "").trim() === LEGACY_EXPIRY_SCRIPT_NAME;
}
