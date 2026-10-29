/**
 * The only way this app fetches a URL a tenant gave it.
 *
 * A decision hook is a tenant's server that we call on every purchase
 * attempt, and its URL is whatever the tenant typed. Fetching that with plain
 * `fetch` is server-side request forgery on demand: `https://169.254.169.254`
 * reads the cloud metadata service, `https://localhost:51821` reaches the
 * WireGuard manager, and a hostname that resolves to a private address does
 * the same while looking innocent at save time.
 *
 * So this:
 *
 *  - accepts only `https:` on port 443, with no credentials in the URL and no
 *    raw IP address in any notation (the URL parser normalises decimal, octal
 *    and hex hosts to dotted form, so one check covers them all);
 *  - checks **every** address the hostname resolves to, inside the
 *    connection's own lookup. The address checked is the address connected
 *    to, so there is no gap for DNS rebinding between a check and a connect;
 *  - allows only addresses ipaddr.js classes as plain `unicast`. That is an
 *    allowlist: loopback, private, CGNAT, link-local (and with it the metadata
 *    address), multicast, reserved, IPv6 unique-local, 6to4 and NAT64 are all
 *    other classes, so nothing has to be remembered to be blocked;
 *  - never follows a redirect, and treats anything but a 2xx as a failure;
 *  - holds one deadline over DNS, connect, TLS, headers and body, and stops
 *    reading at a byte cap.
 *
 * TLS is still verified against the hostname: only the lookup is replaced.
 *
 * Router calls in lib/mikrotik.ts must never use this, and this must never be
 * loosened for them: a router's WireGuard address is private by design.
 *
 * `createSafeFetch` exists so the tests can exercise the timeout, size cap and
 * redirect handling against a local server with a relaxed policy. Production
 * code uses `safeFetch`, which is the strict one.
 */

import dns from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";

export type SafeFetchErrorKind =
  | "url"
  | "address"
  | "timeout"
  | "too_large"
  | "network";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly kind: SafeFetchErrorKind
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

/** True only for an ordinary public internet address. */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    // `::ffff:127.0.0.1` is loopback wearing an IPv6 coat.
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  return addr.range() === "unicast";
}

/**
 * Throws unless `raw` is a URL a hook may point at. Syntax only: whether
 * the name resolves somewhere public is decided at connect time.
 */
export function assertHookUrl(raw: string): URL {
  if (raw.length > 2048) throw new SafeFetchError("URL is too long", "url");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("That is not a valid URL", "url");
  }

  if (url.protocol !== "https:") {
    throw new SafeFetchError("The URL must start with https://", "url");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new SafeFetchError("Only the standard HTTPS port (443) is allowed", "url");
  }
  if (url.username || url.password) {
    throw new SafeFetchError(
      "Put credentials in your server's own checks, not in the URL",
      "url"
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) {
    throw new SafeFetchError("Use a hostname, not an IP address", "url");
  }
  const lower = host.toLowerCase();
  if (
    !lower.includes(".") ||
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    throw new SafeFetchError("Use a public hostname", "url");
  }

  return url;
}

type LookupAddress = { address: string; family: number };
type LookupFn = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
) => void;

export interface FetchPolicy {
  checkUrl(raw: string): URL;
  allowAddress(ip: string): boolean;
  lookup: LookupFn;
}

export const STRICT_POLICY: FetchPolicy = {
  checkUrl: assertHookUrl,
  allowAddress: isPublicAddress,
  lookup: (hostname, options, callback) => dns.lookup(hostname, options, callback),
};

export interface SafeFetchOptions {
  method: "POST" | "GET";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface SafeFetchResponse {
  status: number;
  ok: boolean;
  body: string;
}

export function createSafeFetch(policy: FetchPolicy) {
  const agent = new Agent({
    connect: {
      // Node's lookup contract: it may ask for one address or for all of
      // them (`all: true` under happy-eyeballs), and the answer must come
      // back in the shape asked for. Every address is checked either way.
      lookup(hostname, options, callback) {
        const cb = callback as unknown as (
          err: Error | null,
          address: string | LookupAddress[],
          family?: number
        ) => void;
        policy.lookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, options.all ? [] : "", 4);
          if (!addresses || addresses.length === 0) {
            return cb(new SafeFetchError(`${hostname} did not resolve`, "address"), options.all ? [] : "", 4);
          }
          const blocked = addresses.find((a) => !policy.allowAddress(a.address));
          if (blocked) {
            return cb(
              new SafeFetchError(
                `${hostname} resolves to an address hooks may not reach`,
                "address"
              ),
              options.all ? [] : "",
              4
            );
          }
          return options.all
            ? cb(null, addresses)
            : cb(null, addresses[0].address, addresses[0].family);
        });
      },
    },
  });

  return async function safeFetch(
    rawUrl: string,
    options: SafeFetchOptions
  ): Promise<SafeFetchResponse> {
    const url = policy.checkUrl(rawUrl);
    const signal = AbortSignal.timeout(options.timeoutMs);

    let response: Awaited<ReturnType<typeof request>>;
    try {
      response = await request(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        dispatcher: agent,
        signal,
        headersTimeout: options.timeoutMs,
        bodyTimeout: options.timeoutMs,
      });
    } catch (error) {
      throw classify(error, signal);
    }

    // Collected as bytes and decoded once at the end: decoding chunk by
    // chunk splits a multibyte character across two chunks, and counting
    // characters lets a body of emoji through at four times the cap.
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        if (bytes > options.maxBytes) {
          response.body.destroy();
          throw new SafeFetchError("Response was larger than allowed", "too_large");
        }
        chunks.push(buf);
      }
    } catch (error) {
      throw classify(error, signal);
    }

    return {
      status: response.statusCode,
      // A redirect is never followed, so a 3xx is a failure like any other
      // non-2xx, not a success with no body.
      ok: response.statusCode >= 200 && response.statusCode < 300,
      body: Buffer.concat(chunks).toString("utf8"),
    };
  };
}

function classify(error: unknown, signal: AbortSignal): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  // The lookup's own refusal arrives wrapped by undici.
  const cause = (error as { cause?: unknown })?.cause;
  if (cause instanceof SafeFetchError) return cause;
  if (signal.aborted) return new SafeFetchError("Timed out", "timeout");
  const name = (error as { name?: string; code?: string })?.name ?? "";
  const code = (error as { code?: string })?.code ?? "";
  if (/Timeout/i.test(name) || /TIMEOUT/i.test(code)) {
    return new SafeFetchError("Timed out", "timeout");
  }
  return new SafeFetchError(
    error instanceof Error ? error.message : "Request failed",
    "network"
  );
}

/** The strict fetcher. The only one production code should import. */
export const safeFetch = createSafeFetch(STRICT_POLICY);

/**
 * Save-time courtesy: resolves the hostname now and says plainly if it
 * points somewhere hooks may not go. Not a security control (DNS can change
 * after saving); the connect-time check above is.
 */
export async function checkHookHostResolves(raw: string): Promise<void> {
  const url = assertHookUrl(raw);
  let addresses: LookupAddress[];
  try {
    addresses = await dns.promises.lookup(url.hostname, { all: true });
  } catch {
    throw new SafeFetchError(`${url.hostname} does not resolve`, "address");
  }
  if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new SafeFetchError(
      `${url.hostname} resolves to an address hooks may not reach`,
      "address"
    );
  }
}
