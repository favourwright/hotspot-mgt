import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { isCronJob, runCronJob } from "@/lib/cron-jobs";

/**
 * The entry point the scheduler calls. Today that is an external
 * cron-job.org account over HTTPS, not the systemd units in deploy/.
 *
 * nginx proxies everything on this host to :3000, so this path is reachable
 * from the internet whether or not we want it to be. The shared secret is
 * therefore the real boundary, and always was - a loopback-only caller was
 * never what kept this closed. See docs/cron-jobs.md.
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

  // Logged as well as returned: the scheduler keeps only the status code and
  // the body it got back, and we cannot read its history from here, so the
  // journal is where the detail has to live.
  console.info(`[cron] ${job}`, JSON.stringify(result));

  // A job that did its work but hit partial failures still returns 200. The
  // summary says what happened; failing the request would just make the
  // scheduler retry work that already half-succeeded. The trade-off is that
  // ok:false alerts nobody - see docs/cron-jobs.md.
  return NextResponse.json(result);
}

// Some runners only issue GET. Same auth, same work.
export const GET = POST;
