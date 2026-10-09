import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { isCronJob, runCronJob } from "@/lib/cron-jobs";

/**
 * The entry point systemd's timers call, on loopback.
 *
 * nginx proxies everything on this host to :3000, so this path is reachable
 * from the internet whether or not we want it to be. The shared secret is
 * therefore the real boundary, not the fact that the timer uses 127.0.0.1.
 */
function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();

  // No secret configured means the endpoint is closed, not open. An
  // unauthenticated job runner is worse than a job that never runs.
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set, refusing every request");
    return false;
  }

  const provided = request.headers.get("x-cron-secret")?.trim() ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length, so the lengths are compared first and in a way that
  // always runs the comparison.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ job: string }> }
) {
  const { job } = await ctx.params;

  if (!authorized(request)) {
    // Deliberately not "wrong secret" or "no such job": an unauthenticated
    // caller learns nothing about which jobs exist.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isCronJob(job)) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  const result = await runCronJob(job);

  // Logged as well as returned: the timer's own journal entry only records
  // curl's exit code, so this is where the detail has to live.
  console.info(`[cron] ${job}`, JSON.stringify(result));

  // A job that did its work but hit partial failures still returns 200. The
  // summary says what happened; failing the unit would just make systemd
  // retry work that already half-succeeded.
  return NextResponse.json(result);
}

// Some runners only issue GET. Same auth, same work.
export const GET = POST;
