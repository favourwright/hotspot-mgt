/**
 * Signing what we send to a tenant's hook, so their server can tell it came
 * from us and is not a replay.
 *
 * The scheme is Stripe's: HMAC-SHA256 over `<timestamp>.<raw body>`, sent as
 *
 *   OgaWiFi-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]
 *
 * The timestamp is inside what is signed, so an old request cannot be
 * re-sent with a fresh one, and a receiver rejects anything older than a few
 * minutes. During a secret rotation two `v1` values are sent, one per
 * secret, so the tenant can deploy the new secret at their own pace.
 *
 * `verifySignatureHeader` is the reference receiver: the tests use it, and
 * docs/decision-hooks.md shows tenants the same steps.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "OgaWiFi-Signature";

/** How old a signed request may be before a receiver should refuse it. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function signatureHeader(
  secrets: readonly string[],
  timestamp: number,
  rawBody: string
): string {
  return [
    `t=${timestamp}`,
    ...secrets.map((s) => `v1=${signPayload(s, timestamp, rawBody)}`),
  ].join(",");
}

/**
 * True when `header` carries a valid signature of `rawBody` under `secret`,
 * made within the tolerance of `nowSeconds`. Rejects timestamps from the
 * future too (beyond a minute of clock skew), and compares in constant
 * time after checking lengths, because `timingSafeEqual` throws on unequal
 * lengths rather than returning false.
 */
export function verifySignatureHeader(
  header: string,
  secret: string,
  rawBody: string,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS
): boolean {
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  if (!Number.isInteger(t)) return false;
  if (nowSeconds - t > toleranceSeconds) return false;
  if (t - nowSeconds > 60) return false;

  const expected = Buffer.from(signPayload(secret, t, rawBody), "utf8");
  return parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3), "utf8");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

/* ------------------------------------------------ account linking */

/**
 * How long a tenant's signed "this is our customer X" may take to arrive.
 * Generous, because a person is logging in on the tenant's site in between,
 * but short enough that a captured callback URL is useless by tomorrow.
 */
export const LINK_SIGNATURE_TOLERANCE_SECONDS = 15 * 60;

/** The tenant's own customer id, as we will store and send it back. */
export const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._:@+-]{1,128}$/;

/**
 * What the tenant signs when it sends a verified customer back to us:
 * HMAC-SHA256 of `<t>.<state>.<external_id>` with the hook's secret, hex.
 * The state is ours and single-use, so a signature is bound to one attempt
 * by one signed-in customer; the time stops a stale one being replayed.
 */
export function signLinkCallback(
  secret: string,
  timestamp: number,
  state: string,
  externalId: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${state}.${externalId}`)
    .digest("hex");
}

export function verifyLinkCallback(
  secrets: readonly string[],
  params: { t: string | null; state: string; externalId: string; sig: string | null },
  nowSeconds: number
): boolean {
  const t = Number(params.t);
  if (!Number.isInteger(t) || !params.sig) return false;
  if (nowSeconds - t > LINK_SIGNATURE_TOLERANCE_SECONDS) return false;
  if (t - nowSeconds > 60) return false;
  if (!EXTERNAL_ID_PATTERN.test(params.externalId)) return false;

  const given = Buffer.from(params.sig, "utf8");
  return secrets.some((secret) => {
    const expected = Buffer.from(signLinkCallback(secret, t, params.state, params.externalId), "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

