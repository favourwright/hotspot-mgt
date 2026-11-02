/**
 * What a router address is allowed to be.
 *
 * `routerIp` is typed by a tenant and every router call fetches it from this
 * server, carrying whatever comes back into API responses and error messages.
 * Unchecked, that is server-side request forgery: loopback, the cloud metadata
 * service, anything else this VPS can reach that the internet cannot. A value
 * with a `/`, `?` or `#` in it also discards the `/rest/...` suffix and picks
 * the path as well as the host.
 *
 * Enforced by `mikrotikRequest`, the one place a router is fetched, so no call
 * site can forget it. The routes also check at save time, purely so a tenant
 * gets told why instead of finding out later.
 *
 * A literal IPv4 address and an optional port, nothing else. No hostnames: a
 * name can resolve somewhere else tomorrow, and this path deliberately does not
 * go through lib/safe-fetch.ts, whose connect-time check would refuse the
 * private tunnel addresses this needs to reach (docs/auth-and-security.md).
 *
 * Allowed destinations are public unicast addresses and this product's own
 * tunnel subnet. If `tunnelSubnet` ever changes, this list is a fourth place to
 * change it (docs/router-and-wireguard.md). `10.10.10.0/24` is deliberately
 * absent: that subnet belongs to another product on the same VPS.
 */
import ipaddr from "ipaddr.js";

export const ROUTER_TUNNEL_SUBNETS = ["10.20.0.0/24"] as const;

export type RouterAddressKind = "public" | "tunnel";

const SHAPE = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/;

/** The kind of address this is, or null when a router may not live there. */
export function routerAddressKind(raw: unknown): RouterAddressKind | null {
  if (typeof raw !== "string") return null;

  const match = SHAPE.exec(raw);
  if (!match) return null;

  const [, host, port] = match;
  // Strict four-part decimal only. `ipaddr.parse` alone would also accept
  // forms like 0177.0.0.1, which SHAPE lets through and which mean loopback.
  if (!ipaddr.IPv4.isValidFourPartDecimal(host)) return null;
  if (host.split(".").some((octet) => octet.length > 1 && octet.startsWith("0"))) {
    return null;
  }
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;

  const address = ipaddr.IPv4.parse(host);
  const inTunnel = ROUTER_TUNNEL_SUBNETS.some((subnet) =>
    address.match(ipaddr.IPv4.parseCIDR(subnet))
  );
  if (inTunnel) return "tunnel";

  return address.range() === "unicast" ? "public" : null;
}

/**
 * Save-time check, which also knows how the router claims to be connected: a
 * "direct" router is a public address, a "wireguard" one is on the tunnel.
 * Returns the reason to show the tenant, or null when the address is fine.
 */
export function routerAddressProblem(
  raw: unknown,
  connectionMethod: "wireguard" | "direct"
): string | null {
  const kind = routerAddressKind(raw);
  if (connectionMethod === "direct" && kind !== "public") {
    return "Enter the router's public IP address, like 203.0.113.10 or 203.0.113.10:8080. Private addresses cannot be reached from our servers; use the WireGuard option instead.";
  }
  if (connectionMethod === "wireguard" && kind !== "tunnel") {
    return "That is not an address on our WireGuard tunnel. Start the router setup again.";
  }
  return null;
}
