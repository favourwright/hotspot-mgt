import { randomBytes } from "crypto";

export interface RouterConfig {
  ip: string;
  username: string;
  password: string;
}

export interface MikrotikResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface HotspotUser {
  ".id": string;
  name: string;
  password: string;
  profile: string;
  comment?: string;
  disabled: string;
  "limit-uptime"?: string;
  "limit-bytes-total"?: string;
  /** Read-only counter: how much connected time this user has consumed. */
  uptime?: string;
  /** Read-only counters: data consumed across all of this user's sessions. */
  "bytes-in"?: string;
  "bytes-out"?: string;
}

export interface ActiveSession {
  ".id": string;
  user: string;
  address: string;
  "mac-address": string;
  "bytes-in": string;
  "bytes-out": string;
  /**
   * How long this session has been connected. Note there is no
   * `session-time` field on /ip/hotspot/active despite the name being an
   * obvious guess -- the real pair is `uptime` (elapsed) and
   * `session-time-left` (remaining). Requesting `session-time` returned
   * nothing, so the UI showed an empty column.
   */
  uptime: string;
}

export interface HotspotProfile {
  ".id": string;
  name: string;
  "rate-limit"?: string;
  "session-timeout"?: string;
  "shared-users"?: string;
  "keepalive-timeout"?: string;
  "status-autorefresh"?: string;
  "idle-timeout"?: string;
  "transparent-proxy"?: string;
}

/**
 * How long to wait on a router before giving up.
 *
 * Load-bearing for anything that polls: these devices sit behind a
 * WireGuard tunnel in someone's shop and can be off, asleep, or on a
 * congested uplink. Without a deadline, Node's defaults let a dead router
 * hold a socket for minutes, so a 15s poll interval would stack unfinished
 * requests faster than they drain.
 */
const ROUTER_TIMEOUT_MS = 8000;

async function mikrotikRequest<T>(
  config: RouterConfig,
  method: "GET" | "PUT" | "PATCH" | "DELETE" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<MikrotikResult<T>> {
  const timeout = AbortSignal.timeout(ROUTER_TIMEOUT_MS);
  try {
    // const url = `https://${config.ip}/rest${path}`;
    const url = `http://${config.ip}/rest${path}`;
    const auth = Buffer.from(`${config.username}:${config.password}`).toString(
      "base64"
    );

    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
    };

    if (body && (method === "PUT" || method === "POST" || method === "PATCH")) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      signal: timeout,
      body: body ? JSON.stringify(body) : undefined,
      // In development, we may need to handle self-signed certs
      // Next.js fetch doesn't expose rejectUnauthorized, so we rely on the runtime
      // For Node.js runtime in development, you might need NODE_TLS_REJECT_UNAUTHORIZED=0
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorBody = await response.json();
        // RouterOS answers `{ error: 400, message: "Bad Request", detail:
        // "<the actual reason>" }` -- `error` is the numeric status, so
        // reading it first throws away the only useful field. `detail`
        // carries what actually went wrong.
        const parts = [errorBody.detail, errorBody.message]
          .filter((part): part is string => typeof part === "string" && part.length > 0);

        if (parts.length > 0) {
          errorMessage = `${parts.join(" - ")} (HTTP ${response.status})`;
        }
      } catch {
        // Not JSON; the status line is all we have.
      }
      return { success: false, error: errorMessage };
    }

    // Handle responses
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const data = await response.json();
      return { success: true, data: data as T };
    } else {
      // For DELETE or other non-JSON responses
      return { success: true, data: undefined as T };
    }
  } catch (error) {
    // A timeout surfaces as TimeoutError; say so plainly, because
    // "unreachable" and "slow" lead a tenant to different actions.
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        success: false,
        error: `Router did not respond within ${ROUTER_TIMEOUT_MS / 1000}s`,
      };
    }
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

/**
 * Turn a plan's `dataLimit` into bytes for `limit-bytes-total`.
 *
 * The stored form comes from the plan dialog as `<number><MB|GB>`, or the
 * literal "Unlimited", or null. Anything that is not a parseable quantity
 * means no cap, which is returned as null so the caller omits the field
 * entirely rather than sending a limit of 0 - RouterOS reads 0 as "no
 * limit" too, but an explicit field is harder to tell apart from a
 * deliberate cap when reading the config later.
 *
 * Binary units, matching both RouterOS and the users already on these
 * routers: the 100GB tier there is stored as 107374182400, which is
 * 100 * 1024^3.
 */
export function parseDataLimitBytes(
  dataLimit: string | null | undefined
): number | null {
  if (!dataLimit) return null;

  const match = /^\s*(\d+(?:\.\d+)?)\s*(MB|GB|TB)\s*$/i.exec(dataLimit);
  if (!match) return null;

  const scale: Record<string, number> = {
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  const bytes = Math.round(
    parseFloat(match[1]) * scale[match[2].toUpperCase()]
  );

  return bytes > 0 ? bytes : null;
}

export async function createHotspotUser(
  config: RouterConfig,
  user: {
    username: string;
    password: string;
    profile: string;
    comment?: string;
    /** The plan's `dataLimit` string, e.g. "5GB". Omitted means no cap. */
    dataLimit?: string | null;
  }
): Promise<MikrotikResult<HotspotUser>> {
  const body: Record<string, string> = {
    name: user.username,
    password: user.password,
    profile: user.profile,
  };

  if (user.comment) {
    body.comment = user.comment;
  }

  // Without this the plan's data allowance is sold, shown on the receipt and
  // emailed to the customer, and then enforced by nothing at all. It is also
  // what the status page's data meter measures against, since RouterOS has
  // no other record of what the plan was supposed to include.
  const limitBytes = parseDataLimitBytes(user.dataLimit);
  if (limitBytes !== null) {
    body["limit-bytes-total"] = String(limitBytes);
  }

  return mikrotikRequest<HotspotUser>(config, "PUT", "/ip/hotspot/user", body);
}

/**
 * Edits a hotspot user that already exists. The renewal path, and the only
 * place anything other than the router's own scripts rewrites a user's
 * comment.
 *
 * Two-step, like `deleteHotspotUser`: RouterOS addresses records by `.id`,
 * and the name is only a queryable field. Finding nothing is reported as a
 * failure rather than silently doing nothing, because every caller here is
 * acting on a user it believes it created - if it is gone, the renewal must
 * fall back to minting, not report success over a write that never landed.
 */
export async function updateHotspotUser(
  config: RouterConfig,
  username: string,
  patch: Record<string, string>
): Promise<MikrotikResult<void>> {
  const findResult = await mikrotikRequest<HotspotUser[]>(
    config,
    "GET",
    `/ip/hotspot/user?name=${encodeURIComponent(username)}`
  );

  if (!findResult.success) {
    return { success: false, error: findResult.error };
  }

  if (!findResult.data || findResult.data.length === 0) {
    return { success: false, error: `User ${username} not found` };
  }

  return mikrotikRequest<void>(
    config,
    "PATCH",
    `/ip/hotspot/user/${findResult.data[0][".id"]}`,
    patch
  );
}

/**
 * Puts an existing hotspot user back to the state `createHotspotUser` would
 * have left a brand new one in, under the same name.
 *
 * Only reached for a customer who chose their own credentials: their router
 * username is fixed, so a second purchase after the first one expired has
 * nowhere else to go - creating it again fails on the duplicate name, and
 * appending something to make it unique would hand them a username they did
 * not choose, which is the one thing the feature exists to avoid.
 *
 * The counter reset is the part that must not be skipped. RouterOS measures
 * a user's lifetime `bytes-in`/`bytes-out` against `limit-bytes-total`, so a
 * revived user carrying last month's counters would arrive already over
 * their new allowance and be cut off immediately, having just paid.
 *
 * `comment` goes back to the unactivated marker so the profile's on-login
 * script stamps a fresh expiry the next time they connect, and
 * `limit-uptime` is cleared because the expiry sweeper is what clamped it to
 * 1s when the old plan ran out.
 */
export async function reviveHotspotUser(
  config: RouterConfig,
  username: string,
  user: {
    password: string;
    profile: string;
    dataLimit?: string | null;
  }
): Promise<MikrotikResult<void>> {
  const findResult = await mikrotikRequest<HotspotUser[]>(
    config,
    "GET",
    `/ip/hotspot/user?name=${encodeURIComponent(username)}`
  );

  if (!findResult.success) {
    return { success: false, error: findResult.error };
  }
  if (!findResult.data || findResult.data.length === 0) {
    return { success: false, error: `User ${username} not found` };
  }

  const id = findResult.data[0][".id"];
  const limitBytes = parseDataLimitBytes(user.dataLimit);

  const patch = await mikrotikRequest<void>(
    config,
    "PATCH",
    `/ip/hotspot/user/${id}`,
    {
      password: user.password,
      profile: user.profile,
      comment: "vc",
      disabled: "false",
      // "0" is RouterOS for no limit in both of these. Sent explicitly
      // rather than omitted: this is an edit, and a field left out of a
      // PATCH keeps whatever the dead plan left behind.
      "limit-uptime": "0",
      "limit-bytes-total": String(limitBytes ?? 0),
    }
  );

  if (!patch.success) return patch;

  return mikrotikRequest<void>(config, "POST", "/ip/hotspot/user/reset-counters", {
    ".id": id,
  });
}

export async function deleteHotspotUser(
  config: RouterConfig,
  username: string
): Promise<MikrotikResult<void>> {
  // First, find the user by name to get the .id
  const findResult = await mikrotikRequest<HotspotUser[]>(
    config,
    "GET",
    `/ip/hotspot/user?name=${encodeURIComponent(username)}`
  );

  if (!findResult.success) {
    return { success: false, error: findResult.error };
  }

  if (!findResult.data || findResult.data.length === 0) {
    return { success: false, error: `User ${username} not found` };
  }

  const userId = findResult.data[0][".id"];

  // Now delete using the .id
  return mikrotikRequest<void>(config, "DELETE", `/ip/hotspot/user/${userId}`);
}

export async function hotspotUserExists(
  config: RouterConfig,
  username: string
): Promise<MikrotikResult<boolean>> {
  const result = await mikrotikRequest<HotspotUser[]>(
    config,
    "GET",
    `/ip/hotspot/user?name=${encodeURIComponent(username)}`
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const exists = result.data && result.data.length > 0;
  return { success: true, data: exists };
}

/**
 * `.proplist` keeps the response to the fields we actually render. A
 * long-running hotspot can hold thousands of users, and these routers are
 * often on a metered uplink - shipping full records on every refresh is the
 * difference between a few KB and a few MB.
 */
function proplist(fields: readonly string[]): string {
  return `?.proplist=${fields.join(",")}`;
}

const HOTSPOT_USER_FIELDS = [
  ".id",
  "name",
  "profile",
  "comment",
  "disabled",
  "limit-uptime",
  "limit-bytes-total",
  "uptime",
] as const;

const ACTIVE_SESSION_FIELDS = [
  ".id",
  "user",
  "address",
  "mac-address",
  "bytes-in",
  "bytes-out",
  "uptime",
] as const;

export async function listHotspotUsers(
  config: RouterConfig
): Promise<MikrotikResult<HotspotUser[]>> {
  return mikrotikRequest<HotspotUser[]>(
    config,
    "GET",
    `/ip/hotspot/user${proplist(HOTSPOT_USER_FIELDS)}`
  );
}

export async function getActiveSessions(
  config: RouterConfig
): Promise<MikrotikResult<ActiveSession[]>> {
  return mikrotikRequest<ActiveSession[]>(
    config,
    "GET",
    `/ip/hotspot/active${proplist(ACTIVE_SESSION_FIELDS)}`
  );
}

/**
 * Counts only.
 *
 * `.proplist=.id` is the lever that matters: the router still returns one
 * entry per row, but each is a single short field instead of the whole
 * record, so a 2,000-user hotspot sends a few KB rather than megabytes.
 * Nothing but the length is read, so nothing heavier is requested.
 */
export async function countHotspotUsers(
  config: RouterConfig
): Promise<MikrotikResult<number>> {
  const result = await mikrotikRequest<{ ".id": string }[]>(
    config,
    "GET",
    "/ip/hotspot/user?.proplist=.id"
  );
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data?.length ?? 0 };
}

export async function countActiveSessions(
  config: RouterConfig
): Promise<MikrotikResult<number>> {
  const result = await mikrotikRequest<{ ".id": string }[]>(
    config,
    "GET",
    "/ip/hotspot/active?.proplist=.id"
  );
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data?.length ?? 0 };
}

/**
 * One user's full record, for the detail view. No `.proplist` here on
 * purpose: this is a single row, so the whole record costs nothing, and it
 * carries the fields the list deliberately leaves out - the password and
 * the lifetime byte counters.
 */
export async function findHotspotUser(
  config: RouterConfig,
  username: string
): Promise<MikrotikResult<HotspotUser | null>> {
  const result = await mikrotikRequest<HotspotUser[]>(
    config,
    "GET",
    `/ip/hotspot/user?name=${encodeURIComponent(username)}`
  );
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data?.[0] ?? null };
}

/**
 * Every live session this user currently holds.
 *
 * Plural deliberately. A profile with `shared-users` above 1 lets one
 * voucher cover several devices at once, and a router in production was
 * observed carrying two concurrent sessions for the same username. Reading
 * only the first undercounts such a plan's usage by whatever the other
 * devices have moved, which on the sampled router was the larger half.
 */
export async function findActiveSessionsForUser(
  config: RouterConfig,
  username: string
): Promise<MikrotikResult<ActiveSession[]>> {
  const result = await mikrotikRequest<ActiveSession[]>(
    config,
    "GET",
    `/ip/hotspot/active?user=${encodeURIComponent(username)}`
  );
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data ?? [] };
}

/**
 * How much of their allowance a user has actually consumed, live.
 *
 * The one implementation of this sum, because getting it wrong is invisible
 * on screen: every candidate figure below is a plausible-looking number, and
 * three of the four are wrong while a session is open.
 *
 * `/ip/hotspot/user`'s `bytes-in`/`bytes-out` are the lifetime counters, but
 * RouterOS only folds a session into them when that session *ends*. Measured
 * against a live router over a 10 minute window: all 56 user-counter
 * readings across 28 concurrent sessions moved by exactly 0, while 51 of the
 * 56 matching session counters moved, one of them by 132MB. So on their own
 * they report a user's first session as 0 bytes used, for its whole life.
 *
 * The tempting fix is the session's own `limit-bytes-total`, which reads
 * like a remaining-allowance and is what the router-rendered status page
 * uses as `$(remain-bytes-total)`. Over REST it is not that. It is a
 * snapshot taken at login, and it never moves again: across all 28 sessions
 * it held to
 *
 *     active["limit-bytes-total"] === user["limit-bytes-total"]
 *                                    - (user["bytes-in"] + user["bytes-out"])
 *
 * exactly, with zero drift over the window. Deriving usage from it therefore
 * returns the frozen user counters by a longer route. (`remain-bytes-total`
 * itself is a page-render variable; it is absent from the REST fields, which
 * is why the portal page can do this and we cannot.)
 *
 * What is left is the only pair REST updates live, added to the lifetime
 * counters they will eventually be folded into. The two never overlap: the
 * identity above only holds because a session's bytes reach the user record
 * at logout and not before, which is the same fact that makes the sum safe.
 */
export function totalBytesUsed(
  user: Pick<HotspotUser, "bytes-in" | "bytes-out"> | null | undefined,
  sessions: readonly Pick<ActiveSession, "bytes-in" | "bytes-out">[]
): number | null {
  const counter = (value: string | undefined): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  // Null, not 0, when the router told us nothing at all: an unreachable
  // router and a genuinely unused voucher must not render as the same
  // "0 B used", which reads as fact rather than as a missing answer.
  if (!user && sessions.length === 0) return null;
  if (
    user &&
    user["bytes-in"] === undefined &&
    user["bytes-out"] === undefined &&
    sessions.length === 0
  ) {
    return null;
  }

  return (
    counter(user?.["bytes-in"]) +
    counter(user?.["bytes-out"]) +
    sessions.reduce(
      (sum, session) =>
        sum + counter(session["bytes-in"]) + counter(session["bytes-out"]),
      0
    )
  );
}

/**
 * MikroTik durations look like "4m21s", "1h2m3s" or "2d3h4m5s". Returns
 * seconds, or null when the shape is not recognised - these strings are
 * used for arithmetic (working out when a session began), so a wrong guess
 * is worse than no answer.
 */
export function parseMikrotikDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(
    value.trim()
  );
  if (!match || match.slice(1).every((part) => part === undefined)) return null;

  const [weeks, days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => (part ? Number(part) : 0));

  return (
    weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds
  );
}

export async function testRouterConnection(
  config: RouterConfig
): Promise<MikrotikResult<{ version: string; uptime: string }>> {
  const result = await mikrotikRequest<Record<string, string>>(
    config,
    "GET",
    "/system/resource"
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  if (!result.data) {
    return { success: false, error: "No data returned from router" };
  }

  return {
    success: true,
    data: {
      version: result.data.version || "unknown",
      uptime: result.data.uptime || "unknown",
    },
  };
}

export async function listHotspotProfiles(
  config: RouterConfig
): Promise<MikrotikResult<HotspotProfile[]>> {
  return mikrotikRequest<HotspotProfile[]>(config, "GET", "/ip/hotspot/user/profile");
}

export async function createHotspotProfile(
  config: RouterConfig,
  profile: {
    name: string;
    rateLimit?: string;
    /**
     * RouterOS `keepalive-timeout`: how long a client can stop responding
     * before the router logs it out. Not `session-timeout`, which caps the
     * total length of a session regardless of activity - that would cut a
     * customer off mid-use even while they were still connected, and voucher
     * validity is already enforced by the profile's on-login script.
     */
    keepaliveTimeout?: string;
    sharedUsers?: string;
  }
): Promise<MikrotikResult<HotspotProfile>> {
  const body: Record<string, string> = {
    name: profile.name,
  };

  if (profile.rateLimit) {
    body["rate-limit"] = profile.rateLimit;
  }

  if (profile.keepaliveTimeout) {
    body["keepalive-timeout"] = profile.keepaliveTimeout;
  }

  if (profile.sharedUsers) {
    body["shared-users"] = profile.sharedUsers;
  }

  return mikrotikRequest<HotspotProfile>(config, "PUT", "/ip/hotspot/user/profile", body);
}

export function generateVoucherCredentials(sameCredentials: boolean = false): {
  username: string;
  password: string;
} {
  const generateRandomString = (length: number): string => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = randomBytes(length);
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  };

  if (sameCredentials) {
    // Generate same credentials for username and password
    const credential = generateRandomString(8);
    return {
      username: credential,
      password: credential,
    };
  }

  return {
    username: `HS-${generateRandomString(8)}`,
    password: generateRandomString(8),
  };
}

/**
 * Smart interval calculator for expiry checker based on plan duration.
 * Internal helper function - not exported.
 * Uses pure math to calculate optimal check intervals.
 */
function getSmartCheckerInterval(value: number, unit: "h" | "d"): string {
  const intervalMinutes = profileSweepIntervalMinutes(value, unit);
  const hours = Math.floor(intervalMinutes / 60);
  const mins = intervalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
}

/**
 * How often the per-profile expiry sweeper runs, in minutes.
 *
 * Twelve checks across a plan's lifetime, clamped to between 5 and 60
 * minutes. The upper clamp is what matters most when reading this: every
 * plan of 12 hours or longer - daily, weekly, monthly alike - is swept
 * hourly.
 *
 * Exported because this number is **not only a scheduler setting**. It is
 * also how long the router is allowed to take before the reconciliation
 * view in lib/hotspot-users.ts is entitled to call a still-enabled user
 * drift. Those two have to be the same number: a page that expects the
 * router to react faster than we ever asked it to reports a problem that
 * does not exist, once per expiry, which is exactly what happened.
 */
export function profileSweepIntervalMinutes(
  value: number,
  unit: "h" | "d"
): number {
  const totalMinutes = unit === "h" ? value * 60 : value * 60 * 24;
  return Math.min(60, Math.max(5, Math.round(totalMinutes / 12)));
}

/**
 * Sanitizes profile name for use in script/scheduler names.
 * Replaces spaces with hyphens and converts to lowercase.
 */
function sanitizeProfileName(profileName: string): string {
  return profileName.replace(/\s+/g, "-").toLowerCase();
}

/**
 * Pushes the per-profile expiry checker script to the router.
 * Script name: vc-check-{profileName}
 */
export async function pushProfileExpiryScript(
  config: RouterConfig,
  profileName: string,
  routerDurationValue: number,
  routerDurationUnit: "h" | "d"
): Promise<MikrotikResult<void>> {
  const sanitizedName = sanitizeProfileName(profileName);
  const scriptName = `vc-check-${sanitizedName}`;

  const scriptSource = `:foreach u in=[/ip hotspot user find profile="${profileName}"] do={
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
}`;

  // Check if script exists
  const existingScripts = await mikrotikRequest<Array<{ ".id": string; name: string }>>(
    config,
    "GET",
    `/system/script?name=${encodeURIComponent(scriptName)}`
  );

  if (existingScripts.success && existingScripts.data && existingScripts.data.length > 0) {
    // Update existing script
    const scriptId = existingScripts.data[0][".id"];
    return mikrotikRequest<void>(
      config,
      "PATCH",
      `/system/script/${scriptId}`,
      { source: scriptSource }
    );
  } else {
    // Create new script
    return mikrotikRequest<void>(config, "PUT", "/system/script", {
      name: scriptName,
      source: scriptSource,
      "dont-require-permissions": "true",
    });
  }
}

/**
 * Pushes the per-profile expiry scheduler to the router.
 * Scheduler name: vc-sched-{profileName}
 */
export async function pushProfileExpiryScheduler(
  config: RouterConfig,
  profileName: string,
  routerDurationValue: number,
  routerDurationUnit: "h" | "d"
): Promise<MikrotikResult<void>> {
  const sanitizedName = sanitizeProfileName(profileName);
  const schedulerName = `vc-sched-${sanitizedName}`;
  const scriptName = `vc-check-${sanitizedName}`;
  const interval = getSmartCheckerInterval(routerDurationValue, routerDurationUnit);

  // Check if scheduler exists
  const existingSchedulers = await mikrotikRequest<Array<{ ".id": string; name: string }>>(
    config,
    "GET",
    `/system/scheduler?name=${encodeURIComponent(schedulerName)}`
  );

  if (existingSchedulers.success && existingSchedulers.data && existingSchedulers.data.length > 0) {
    // Update existing scheduler
    const schedulerId = existingSchedulers.data[0][".id"];
    return mikrotikRequest<void>(
      config,
      "PATCH",
      `/system/scheduler/${schedulerId}`,
      {
        interval,
        "on-event": scriptName,
        disabled: "false",
      }
    );
  } else {
    // Create new scheduler
    return mikrotikRequest<void>(config, "PUT", "/system/scheduler", {
      name: schedulerName,
      interval,
      "on-event": scriptName,
      disabled: "false",
    });
  }
}


/**
 * Pushes the on-login script to a specific hotspot user profile.
 * Also sets up the per-profile expiry checker script and scheduler.
 * The routerDuration is hardcoded into the script as the scheduler interval.
 */
export async function pushProfileLoginScript(
  config: RouterConfig,
  profileName: string,
  routerDurationValue: number,
  routerDurationUnit: "h" | "d"
): Promise<MikrotikResult<void>> {
  // Find the profile by name
  const profileResult = await mikrotikRequest<HotspotProfile[]>(
    config,
    "GET",
    `/ip/hotspot/user/profile?name=${encodeURIComponent(profileName)}`
  );

  if (!profileResult.success) {
    return { success: false, error: profileResult.error };
  }

  if (!profileResult.data || profileResult.data.length === 0) {
    return { success: false, error: "Profile not found on router" };
  }

  const profileId = profileResult.data[0][".id"];

  // Build the RouterOS duration string for the script
  const routerDuration = `${routerDurationValue}${routerDurationUnit}`;

  // Build the on-login script with routerDuration hardcoded
  const scriptSource = `:local comment [/ip hotspot user get [/ip hotspot user find where name=$username] comment]
:local ucode [:pick $comment 0 2]
:if ($ucode = "vc" or $ucode = "up" or $comment = "") do={
  :local date [/system clock get date]
  :local year [:pick $date 7 11]
  :local month [:pick $date 0 3]
  /sys sch add name=$username disable=no start-date=$date interval="${routerDuration}"
  :delay 5s
  :local exp [/sys sch get [/sys sch find where name=$username] next-run]
  :local getxp [:len $exp]
  :if ($getxp = 15) do={
    :local d [:pick $exp 0 6]
    :local t [:pick $exp 7 16]
    :local s "/"
    :local exp ("$d$s$year $t")
    /ip hotspot user set comment=$exp [find where name=$username]
  }
  :if ($getxp = 8) do={
    /ip hotspot user set comment="$date $exp" [find where name=$username]
  }
  :if ($getxp > 15) do={
    /ip hotspot user set comment=$exp [find where name=$username]
  }
  :delay 5s
  /sys sch remove [find where name=$username]
}`;

  // Push the script to the profile
  const updateResult = await mikrotikRequest<void>(
    config,
    "PATCH",
    `/ip/hotspot/user/profile/${profileId}`,
    { "on-login": scriptSource }
  );

  if (!updateResult.success) {
    return { success: false, error: updateResult.error };
  }

  // Push per-profile expiry checker script
  const expiryScriptResult = await pushProfileExpiryScript(config, profileName, routerDurationValue, routerDurationUnit);
  if (!expiryScriptResult.success) {
    return { success: false, error: expiryScriptResult.error };
  }

  // Push per-profile expiry scheduler
  const expirySchedulerResult = await pushProfileExpiryScheduler(config, profileName, routerDurationValue, routerDurationUnit);
  if (!expirySchedulerResult.success) {
    return { success: false, error: expirySchedulerResult.error };
  }

  return { success: true };
}

/* -------------------------------------------------------------------------
 * Captive portal: walled garden, page install, and MAC login.
 * ---------------------------------------------------------------------- */

/**
 * Allow a host through the walled garden, so an unauthenticated client can
 * reach it before logging in.
 *
 * Idempotent by `dst-host`: provisioning runs more than once over a
 * router's life, and MikroTik will happily accumulate duplicate rules that
 * all match, making the list unreadable without changing behaviour.
 */
export async function ensureWalledGardenHost(
  config: RouterConfig,
  host: string
): Promise<MikrotikResult<void>> {
  const existing = await mikrotikRequest<Array<{ ".id": string }>>(
    config,
    "GET",
    `/ip/hotspot/walled-garden?dst-host=${encodeURIComponent(host)}`
  );

  if (!existing.success) return { success: false, error: existing.error };
  if (existing.data && existing.data.length > 0) return { success: true };

  const created = await mikrotikRequest<unknown>(
    config,
    "PUT",
    "/ip/hotspot/walled-garden",
    { "dst-host": host, action: "allow", comment: "ogawifi portal" }
  );

  return created.success
    ? { success: true }
    : { success: false, error: created.error };
}

export async function ensureWalledGarden(
  config: RouterConfig,
  hosts: string[]
): Promise<MikrotikResult<{ allowed: string[]; failed: string[] }>> {
  const allowed: string[] = [];
  const failed: string[] = [];

  for (const host of hosts) {
    const result = await ensureWalledGardenHost(config, host);
    (result.success ? allowed : failed).push(host);
  }

  // A partial failure still leaves a usable portal if the important hosts
  // got through, so report rather than abort -- the caller decides.
  return { success: failed.length === 0, data: { allowed, failed } };
}

/**
 * Pull the portal shim onto the router.
 *
 * `/tool/fetch` rather than an upload: the REST API has no file-upload
 * endpoint, and the router has its own internet connection, so having it
 * download from us is the one path that needs no extra transport. The
 * walled garden doesn't apply here -- that governs hotspot *clients*, not
 * the router itself.
 */
/**
 * Create the portal directory if it isn't there.
 *
 * `/tool fetch` writes a file but will not create the directory above it,
 * so fetching straight to `hotspot-oga/login.html` on a router that has
 * never had the portal installed fails with a bare 400.
 *
 * An "already exists" answer is success: install is meant to be safe to run
 * repeatedly.
 */
/**
 * Where the portal directory actually has to live on *this* router.
 *
 * RouterOS resolves `html-directory` against the device's storage root, and
 * on anything with flash that root is `flash/`. Setting the field to
 * `hotspot-oga` makes the router serve `flash/hotspot-oga`, while a file
 * written to `hotspot-oga/login.html` lands in a different directory at the
 * filesystem root. The install then looks like it worked, and the router
 * keeps serving the stock pages - which is exactly what happened the first
 * time this shipped.
 *
 * Worse, pointing `html-directory` at a name that does not exist makes
 * RouterOS create it and fill it with its own default pages, so the symptom
 * is a stock portal rather than a missing one.
 *
 * The prefix is read off whatever the profiles currently point at rather than
 * guessed, so a router without flash keeps working unprefixed.
 */
export async function resolveHotspotDirectory(
  config: RouterConfig,
  directory: string
): Promise<MikrotikResult<string>> {
  const profiles = await mikrotikRequest<
    Array<{ "html-directory"?: string }>
  >(config, "GET", "/ip/hotspot/profile");

  if (!profiles.success) return { success: false, error: profiles.error };

  for (const profile of profiles.data ?? []) {
    const current = profile["html-directory"];
    if (!current) continue;

    const slash = current.lastIndexOf("/");
    if (slash === -1) continue;

    const prefix = current.slice(0, slash + 1);
    // Already resolved on a previous install; do not stack another prefix.
    if (directory.startsWith(prefix)) return { success: true, data: directory };
    return { success: true, data: `${prefix}${directory}` };
  }

  // No profile carries a prefix, so this device addresses files from the
  // root and the bare name is already correct.
  return { success: true, data: directory };
}

export async function ensurePortalDirectory(
  config: RouterConfig,
  directory: string
): Promise<MikrotikResult<void>> {
  const existing = await mikrotikRequest<Array<{ ".id": string }>>(
    config,
    "GET",
    `/file?name=${encodeURIComponent(directory)}`
  );

  if (existing.success && existing.data && existing.data.length > 0) {
    return { success: true };
  }

  const created = await mikrotikRequest<unknown>(config, "PUT", "/file", {
    name: directory,
    type: "directory",
  });

  if (created.success) return { success: true };

  // Racing another install, or a RouterOS build that reports the existing
  // entry rather than succeeding -- either way the directory is there.
  if (/already have|already exists/i.test(created.error ?? "")) {
    return { success: true };
  }

  return { success: false, error: created.error };
}

/**
 * Write the shim onto the router by sending its contents over the REST API.
 *
 * Preferred over `/tool fetch` because fetch is gated by RouterOS
 * device-mode (7.17+), which refuses it with "not allowed by device-mode"
 * and can only be changed by physically pressing the device's reset button
 * -- impossible for a router sitting in someone's shop.
 *
 * Writing the file directly also removes a dependency we'd rather not have:
 * the router no longer needs to be able to reach us over HTTPS to be
 * provisioned, only the other way round.
 */
export async function writePortalShim(
  config: RouterConfig,
  directory: string,
  contents: string
): Promise<MikrotikResult<void>> {
  return writePortalFile(config, directory, "login.html", contents);
}

/**
 * Write one file into the portal directory, replacing any previous copy.
 *
 * Used for every page we install, not just the login shim: a reinstall has
 * to pick up a changed portal URL or a restyled status page instead of
 * silently keeping the old one.
 *
 * Size is not the constraint it looks like. RouterOS refuses to *return*
 * `contents` for anything over roughly 4KB, which makes files appear
 * unreadable over REST, but writing is unaffected - an 8KB page was
 * verified onto a live router. So read-back is not a usable way to confirm
 * a write; the reported `size` is.
 */
export async function writePortalFile(
  config: RouterConfig,
  directory: string,
  filename: string,
  contents: string
): Promise<MikrotikResult<void>> {
  const path = `${directory}/${filename}`;

  const existing = await mikrotikRequest<Array<{ ".id": string }>>(
    config,
    "GET",
    `/file?name=${encodeURIComponent(path)}`
  );

  if (existing.success && existing.data && existing.data.length > 0) {
    const updated = await mikrotikRequest<unknown>(
      config,
      "PATCH",
      `/file/${existing.data[0][".id"]}`,
      { contents }
    );
    return updated.success
      ? { success: true }
      : { success: false, error: updated.error };
  }

  const created = await mikrotikRequest<unknown>(config, "PUT", "/file", {
    name: path,
    contents,
  });

  return created.success
    ? { success: true }
    : { success: false, error: created.error };
}

/**
 * The original approach, kept as a fallback for routers where writing file
 * contents over REST isn't supported but `fetch` happens to be allowed.
 */
export async function fetchPortalShim(
  config: RouterConfig,
  templateUrl: string,
  directory: string
): Promise<MikrotikResult<void>> {
  const result = await mikrotikRequest<unknown>(config, "POST", "/tool/fetch", {
    url: templateUrl,
    "dst-path": `${directory}/login.html`,
    mode: "https",
  });

  return result.success
    ? { success: true }
    : { success: false, error: result.error };
}

/**
 * What one hotspot server profile pointed at before we touched it.
 *
 * Both `id` and `name` are kept because neither is reliable alone: a `.id`
 * is stable within a RouterOS session but not across a config restore, and
 * a name is stable across one but can be edited by the tenant. Restore
 * tries the id first and falls back to the name.
 */
export interface HotspotProfileDirectory {
  id: string;
  name: string;
  htmlDirectory: string;
  /**
   * The profile's `login-by` before we touched it, so the restore puts the
   * router's own authentication methods back. Optional because installs
   * from before this was captured have no value recorded, and guessing one
   * would be worse than leaving the field alone.
   */
  loginBy?: string;
}

/**
 * The login method our portal needs the router to accept.
 *
 * MikroTik ships `login-by=cookie,http-chap`, which only works with the
 * stock login page: CHAP needs the challenge RouterOS substitutes into its
 * own HTML, and our shim redirects away before any of that is usable. A
 * plain-credential POST against a CHAP-only profile is simply rejected, and
 * the customer sees the form come back with no explanation - which is
 * exactly what "the portal loads but nobody can log in" looks like.
 *
 * Added to whatever is already there rather than replacing it, so
 * `mac-cookie` and friends keep working for clients already relying on them.
 */
const PORTAL_LOGIN_METHOD = "http-pap";

function withPapLogin(current: string | undefined): string {
  const methods = (current ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  if (methods.includes(PORTAL_LOGIN_METHOD)) return methods.join(",");
  return [...methods, PORTAL_LOGIN_METHOD].join(",");
}

/**
 * Point every hotspot server profile at our directory, returning what each
 * one pointed at first. This is the switch that actually swaps the portal
 * over.
 *
 * The return value is per-profile, not a single directory: a router can
 * carry several profiles pointing at different directories, and collapsing
 * them to one value loses every profile but the first. Pass the whole array
 * to `restoreHotspotHtmlDirectories` to undo this.
 */
export async function setHotspotHtmlDirectory(
  config: RouterConfig,
  directory: string
): Promise<
  MikrotikResult<{ profiles: number; previous: HotspotProfileDirectory[] }>
> {
  const profiles = await mikrotikRequest<
    Array<{
      ".id": string;
      name: string;
      "html-directory"?: string;
      "login-by"?: string;
    }>
  >(config, "GET", "/ip/hotspot/profile");

  if (!profiles.success) return { success: false, error: profiles.error };
  if (!profiles.data || profiles.data.length === 0) {
    return { success: false, error: "No hotspot server profile found" };
  }

  // Captured so uninstall restores what was actually there rather than
  // assuming MikroTik's default -- a tenant may already have been pointing
  // at a customised directory of their own. An empty `html-directory` is
  // RouterOS reporting its default, which is "hotspot".
  const previous: HotspotProfileDirectory[] = profiles.data.map((p) => ({
    id: p[".id"],
    name: p.name,
    htmlDirectory: p["html-directory"] || "hotspot",
    loginBy: p["login-by"] ?? "",
  }));

  for (const profile of profiles.data) {
    const updated = await mikrotikRequest<unknown>(
      config,
      "PATCH",
      `/ip/hotspot/profile/${profile[".id"]}`,
      {
        "html-directory": directory,
        "login-by": withPapLogin(profile["login-by"]),
      }
    );
    if (!updated.success) {
      return { success: false, error: updated.error };
    }
  }

  return {
    success: true,
    data: { profiles: profiles.data.length, previous },
  };
}

/**
 * Put each hotspot server profile back on its own previous directory.
 *
 * The inverse of `setHotspotHtmlDirectory`, and deliberately not just
 * "set them all to X": the profiles may have pointed at different
 * directories, and only restoring each to its own is actually a restore.
 *
 * A profile named in `entries` that no longer exists on the router is
 * skipped rather than failing the whole call -- the tenant deleted it
 * while our portal was installed, and there is nothing to put back.
 */
export async function restoreHotspotHtmlDirectories(
  config: RouterConfig,
  entries: HotspotProfileDirectory[]
): Promise<MikrotikResult<{ restored: number; skipped: string[] }>> {
  const profiles = await mikrotikRequest<
    Array<{ ".id": string; name: string; "html-directory"?: string }>
  >(config, "GET", "/ip/hotspot/profile");

  if (!profiles.success) return { success: false, error: profiles.error };

  const current = profiles.data ?? [];
  const skipped: string[] = [];
  let restored = 0;

  for (const entry of entries) {
    const profile =
      current.find((p) => p[".id"] === entry.id) ??
      current.find((p) => p.name === entry.name);

    if (!profile) {
      skipped.push(entry.name);
      continue;
    }

    // `login-by` is only put back when we actually recorded one. An install
    // from before it was captured has no value to restore, and writing an
    // empty string would strip every authentication method the router has.
    const body: Record<string, string> = {
      "html-directory": entry.htmlDirectory,
    };
    if (entry.loginBy) body["login-by"] = entry.loginBy;

    const updated = await mikrotikRequest<unknown>(
      config,
      "PATCH",
      `/ip/hotspot/profile/${profile[".id"]}`,
      body
    );
    if (!updated.success) {
      return { success: false, error: updated.error };
    }
    restored += 1;
  }

  return { success: true, data: { restored, skipped } };
}

/**
 * Removes only the walled-garden entries we added, matched on the comment
 * `ensureWalledGardenHost` stamps them with. A tenant's own rules, and
 * anything another tool put there, are left alone.
 */
export async function removeOurWalledGardenEntries(
  config: RouterConfig
): Promise<MikrotikResult<{ removed: number }>> {
  const existing = await mikrotikRequest<
    Array<{ ".id": string; comment?: string }>
  >(config, "GET", "/ip/hotspot/walled-garden");

  if (!existing.success) return { success: false, error: existing.error };

  const ours = (existing.data ?? []).filter(
    (entry) => entry.comment === "ogawifi portal"
  );

  for (const entry of ours) {
    const deleted = await mikrotikRequest<unknown>(
      config,
      "DELETE",
      `/ip/hotspot/walled-garden/${entry[".id"]}`
    );
    if (!deleted.success) {
      return { success: false, error: deleted.error };
    }
  }

  return { success: true, data: { removed: ours.length } };
}

/**
 * Log a MAC in directly, server-side, without the client posting anything.
 *
 * This is what lets a purchase complete from the Paystack webhook: the
 * customer's browser can close, crash, or be a cut-down captive-portal
 * window, and they still come online.
 *
 * Whether RouterOS exposes this over REST varies by version, so callers
 * must treat failure as expected and fall back to showing credentials.
 */
export async function loginHotspotMac(
  config: RouterConfig,
  params: { mac: string; ip: string; username: string; password: string }
): Promise<MikrotikResult<void>> {
  // `ip` is required, not optional: probing this endpoint returns
  // "missing =ip=" without it. The portal has it from `$(ip)`, which the
  // router substitutes alongside the MAC.
  const result = await mikrotikRequest<unknown>(
    config,
    "POST",
    "/ip/hotspot/active/login",
    {
      "mac-address": params.mac,
      ip: params.ip,
      user: params.username,
      password: params.password,
    }
  );

  return result.success
    ? { success: true }
    : { success: false, error: result.error };
}

/**
 * Does this router support server-side MAC login? Probed rather than
 * assumed, so stage 4 of the portal work is designed against what the
 * hardware actually does.
 */
export async function probeMacLoginSupport(
  config: RouterConfig
): Promise<MikrotikResult<{ supported: boolean; detail: string }>> {
  // Deliberately invalid credentials: we're asking whether the endpoint
  // exists, not trying to log anyone in. A 404 means unsupported; anything
  // else -- including a rejection -- means the command is there.
  const result = await mikrotikRequest<unknown>(
    config,
    "POST",
    "/ip/hotspot/active/login",
    { "mac-address": "00:00:00:00:00:00", user: "__probe__", password: "__probe__" }
  );

  if (result.success) {
    return { success: true, data: { supported: true, detail: "accepted" } };
  }

  const detail = result.error ?? "unknown";
  const unsupported = /404|no such command|not found|unknown command/i.test(detail);

  return {
    success: true,
    data: { supported: !unsupported, detail },
  };
}
