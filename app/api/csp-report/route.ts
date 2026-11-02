import { NextRequest, NextResponse } from "next/server";

import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Where browsers report what the report-only CSP in next.config.ts would have
 * blocked. Public by nature, so it only ever writes one short line to the journal:
 * no Firestore, no email, nothing that spends a quota. Read them with
 * `journalctl -u hotspot-mgt | grep '\[csp\]'`.
 *
 * Only the directive and the blocked origin are logged. A full report can carry
 * URLs with voucher ids and router query strings in them.
 */
const LIMIT = { max: 20, windowMs: 60_000 };
const MAX_BODY_BYTES = 8 * 1024;

function originOf(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  try {
    return new URL(value).origin;
  } catch {
    // "inline", "eval", "self" and friends are not URLs, and are short.
    return value.slice(0, 40);
  }
}

export async function POST(request: NextRequest) {
  const accepted = new NextResponse(null, { status: 204 });

  if (!rateLimit(`csp:${clientIp(request.headers)}`, LIMIT).ok) return accepted;

  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY_BYTES) return accepted;

  try {
    const report = JSON.parse(raw)?.["csp-report"];
    if (report) {
      const directive = String(report["effective-directive"] ?? report["violated-directive"] ?? "unknown");
      console.warn(`[csp] ${directive.slice(0, 40)} blocked ${originOf(report["blocked-uri"])}`);
    }
  } catch {
    // Not JSON. Nothing to learn from it, and no reason to tell the sender.
  }
  return accepted;
}
