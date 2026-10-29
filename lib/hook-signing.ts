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
