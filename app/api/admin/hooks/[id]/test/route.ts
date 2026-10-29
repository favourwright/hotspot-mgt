/**
 * The Test button: one real, signed call to the owner's server with sample
 * data (`"test": true` in the body), through the same SSRF guard as live
 * calls, and the full answer shown back. It never touches the breaker, so
 * debugging cannot trip the owner's own sales.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { rateLimit } from "@/lib/rate-limit";
import { testHook } from "@/lib/decision-hooks";
import {
  badRequest,
  hookErrorResponse,
  loadOwnedHook,
} from "@/lib/decision-hook-admin";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireApiAccess(owner.tenantId);

    // The easiest place to probe a URL guard from, so it is the tightest.
    if (!rateLimit(`hooktest:${owner.tenantId}`, { max: 5, windowMs: 60_000 }).ok) {
      return badRequest("Too many tests. Wait a minute and try again.", 429);
    }

    const hook = await loadOwnedHook(owner.tenantId, id);
    if (!hook) return badRequest("Hook not found", 404);

    const result = await testHook(hook, {
      tenantId: owner.tenantId,
      customer: { uid: owner.uid, email: owner.email, emailVerified: owner.emailVerified === true },
      plan: { id: "plan_test", name: "Test plan", priceKobo: 50000 },
      location: { id: "location_test", name: "Test location" },
      intent: "reuse",
    });

    return NextResponse.json({
      success: true,
      data: {
        requestId: result.requestId,
        latencyMs: result.latencyMs,
        httpStatus: result.status,
        verdict: result.verdict,
        bodyPreview: result.bodyPreview,
      },
    });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
