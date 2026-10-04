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
        if (errorBody.error || errorBody.message || errorBody.detail) {
          errorMessage = errorBody.error || errorBody.message || errorBody.detail;
        }
      } catch {
        // If response is not JSON, use status text
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

export async function createHotspotUser(
  config: RouterConfig,
  user: {
    username: string;
    password: string;
    profile: string;
    comment?: string;
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

  return mikrotikRequest<HotspotUser>(config, "PUT", "/ip/hotspot/user", body);
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
 * carries the fields the list deliberately leaves out — the password and
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

/** The user's live session, when they are connected right now. */
export async function findActiveSessionForUser(
  config: RouterConfig,
  username: string
): Promise<MikrotikResult<ActiveSession | null>> {
  const result = await mikrotikRequest<ActiveSession[]>(
    config,
    "GET",
    `/ip/hotspot/active?user=${encodeURIComponent(username)}`
  );
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data?.[0] ?? null };
}

/**
 * MikroTik durations look like "4m21s", "1h2m3s" or "2d3h4m5s". Returns
 * seconds, or null when the shape is not recognised — these strings are
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
    sessionTimeout?: string;
    sharedUsers?: string;
  }
): Promise<MikrotikResult<HotspotProfile>> {
  const body: Record<string, string> = {
    name: profile.name,
  };

  if (profile.rateLimit) {
    body["rate-limit"] = profile.rateLimit;
  }

  if (profile.sessionTimeout) {
    body["session-timeout"] = profile.sessionTimeout;
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
  const totalMinutes = unit === "h" ? value * 60 : value * 60 * 24;
  const intervalMinutes = Math.min(60, Math.max(5, Math.round(totalMinutes / 12)));
  const hours = Math.floor(intervalMinutes / 60);
  const mins = intervalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
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
 * Point a hotspot server profile at our directory. This is the switch that
 * actually swaps the portal over -- and the single change to undo to go
 * back to MikroTik's stock pages.
 */
export async function setHotspotHtmlDirectory(
  config: RouterConfig,
  directory: string
): Promise<MikrotikResult<{ profiles: number; previous: string[] }>> {
  const profiles = await mikrotikRequest<
    Array<{ ".id": string; name: string; "html-directory"?: string }>
  >(config, "GET", "/ip/hotspot/profile");

  if (!profiles.success) return { success: false, error: profiles.error };
  if (!profiles.data || profiles.data.length === 0) {
    return { success: false, error: "No hotspot server profile found" };
  }

  // Captured so uninstall restores what was actually there rather than
  // assuming MikroTik's default -- a tenant may already have been pointing
  // at a customised directory of their own.
  const previous = profiles.data.map((p) => p["html-directory"] ?? "hotspot");

  for (const profile of profiles.data) {
    const updated = await mikrotikRequest<unknown>(
      config,
      "PATCH",
      `/ip/hotspot/profile/${profile[".id"]}`,
      { "html-directory": directory }
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
  params: { mac: string; username: string; password: string; ip?: string }
): Promise<MikrotikResult<void>> {
  const result = await mikrotikRequest<unknown>(
    config,
    "POST",
    "/ip/hotspot/active/login",
    {
      "mac-address": params.mac,
      user: params.username,
      password: params.password,
      ...(params.ip ? { ip: params.ip } : {}),
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
