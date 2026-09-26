/**
 * WireGuard Manager Client
 * Communicates with the Python WG manager service
 * running on the VPS at localhost:51821
 *
 * Only called from API routes — never from
 * client-side code.
 */

export interface WgManagerResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PeerAddResult {
  assignedIp: string;
  alreadyExists: boolean;
}

export interface PeerStatusResult {
  ip: string;
  reachable: boolean;
}

async function wgManagerRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<WgManagerResult<T>> {
  try {
    const url = process.env.WG_MANAGER_URL;
    const secret = process.env.WG_MANAGER_SECRET;

    if (!url || !secret) {
      return {
        success: false,
        error:
          "WireGuard manager not configured. " +
          "Set WG_MANAGER_URL and WG_MANAGER_SECRET " +
          "in environment variables.",
      };
    }

    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-WG-Secret": secret,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await response.json();

    if (!response.ok || !json.success) {
      return {
        success: false,
        error: json.error || `HTTP ${response.status}`,
      };
    }

    return { success: true, data: json.data };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to connect to WireGuard manager";
    return { success: false, error: message };
  }
}

/**
 * Add a new WireGuard peer for a tenant router.
 * Returns the assigned tunnel IP.
 */
export async function addWgPeer(
  publicKey: string
): Promise<WgManagerResult<PeerAddResult>> {
  return wgManagerRequest<PeerAddResult>("POST", "/peer/add", { publicKey });
}

/**
 * Remove a WireGuard peer.
 */
export async function removeWgPeer(
  publicKey: string
): Promise<WgManagerResult<void>> {
  return wgManagerRequest<void>("DELETE", "/peer/remove", { publicKey });
}

/**
 * Check if a tunnel IP is reachable.
 * Used to verify the tenant's router connected.
 */
export async function checkWgPeerStatus(
  ip: string
): Promise<WgManagerResult<PeerStatusResult>> {
  return wgManagerRequest<PeerStatusResult>("GET", `/peer/status/${ip}`);
}

/**
 * List all current WireGuard peers.
 */
export async function listWgPeers(): Promise<
  WgManagerResult<{ peers: Record<string, string>; count: number }>
> {
  return wgManagerRequest("GET", "/peers");
}

/**
 * Check if the WireGuard manager is running.
 */
export async function checkWgManagerHealth(): Promise<boolean> {
  try {
    const url = process.env.WG_MANAGER_URL;
    if (!url) return false;

    const response = await fetch(`${url}/health`);
    const json = await response.json();
    return json.success === true;
  } catch {
    return false;
  }
}
