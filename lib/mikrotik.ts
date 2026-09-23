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

export function generateVoucherCredentials(): {
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

  return {
    username: `HS-${generateRandomString(8)}`,
    password: generateRandomString(8),
  };
}
