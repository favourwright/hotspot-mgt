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
}

export interface ActiveSession {
  ".id": string;
  user: string;
  address: string;
  "mac-address": string;
  "session-time": string;
  "bytes-in": string;
  "bytes-out": string;
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

async function mikrotikRequest<T>(
  config: RouterConfig,
  method: "GET" | "PUT" | "PATCH" | "DELETE" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<MikrotikResult<T>> {
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

export async function listHotspotUsers(
  config: RouterConfig
): Promise<MikrotikResult<HotspotUser[]>> {
  return mikrotikRequest<HotspotUser[]>(config, "GET", "/ip/hotspot/user");
}

export async function getActiveSessions(
  config: RouterConfig
): Promise<MikrotikResult<ActiveSession[]>> {
  return mikrotikRequest<ActiveSession[]>(config, "GET", "/ip/hotspot/active");
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
 * Pushes the voucher expiry checker script to the router.
 * This script disables users whose expiry datetime has passed.
 */
export async function pushExpiryCheckerScript(
  config: RouterConfig
): Promise<MikrotikResult<void>> {
  const scriptSource = `:foreach u in=[/ip hotspot user find] do={
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
    "/system/script?name=check-voucher-expiry"
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
      name: "check-voucher-expiry",
      source: scriptSource,
      "dont-require-permissions": "true",
    });
  }
}

/**
 * Pushes the expiry scheduler to the router.
 * This scheduler runs the expiry checker script every hour.
 */
export async function pushExpiryScheduler(
  config: RouterConfig
): Promise<MikrotikResult<void>> {
  // Check if scheduler exists
  const existingSchedulers = await mikrotikRequest<Array<{ ".id": string; name: string }>>(
    config,
    "GET",
    "/system/scheduler?name=voucher-expiry-check"
  );

  if (existingSchedulers.success && existingSchedulers.data && existingSchedulers.data.length > 0) {
    // Update existing scheduler
    const schedulerId = existingSchedulers.data[0][".id"];
    return mikrotikRequest<void>(
      config,
      "PATCH",
      `/system/scheduler/${schedulerId}`,
      {
        interval: "01:00:00",
        "on-event": "check-voucher-expiry",
        disabled: "false",
      }
    );
  } else {
    // Create new scheduler
    return mikrotikRequest<void>(config, "PUT", "/system/scheduler", {
      name: "voucher-expiry-check",
      interval: "01:00:00",
      "on-event": "check-voucher-expiry",
      disabled: "false",
    });
  }
}

/**
 * Pushes the on-login script to a specific hotspot user profile.
 * The routerDuration is hardcoded into the script as the scheduler interval.
 */
export async function pushProfileLoginScript(
  config: RouterConfig,
  profileName: string,
  routerDuration: string
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

  return { success: true };
}
