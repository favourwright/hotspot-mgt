/**
 * The visitor's address, for use as a rate-limit key behind nginx.
 *
 * The *last* X-Forwarded-For entry, not the first. nginx appends the address it
 * actually saw (`$proxy_add_x_forwarded_for`), so the last one is ours and
 * everything before it is whatever the client sent. Reading the first entry, as
 * this used to, let anyone pick a new limiter key per request by sending the
 * header themselves.
 *
 * Remember a whole hotspot shares one public address: limits keyed on this have
 * to allow for a venue's worth of people. Prefer a verified uid when there is one.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || headers.get("x-real-ip") || "unknown";
}
