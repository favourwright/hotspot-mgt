/**
 * Create or end a plan-fee waiver for one tenant. Superadmin only.
 *
 * A waiver is never deleted, only revoked, so the history still answers
 * "was this tenant comped last March" after someone ends one early.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { z } from "zod";

const createSchema = z.object({
  /**
   * ISO date. Required: a waiver always ends.
   *
   * A comp that never ends is a commercial decision about one account and
   * belongs on a plan a superadmin assigns, where it is visible on the
   * tenant's own billing and survives someone deleting a waiver. Allowing a
   * null here would leave a way to create an open-ended comp that the UI
   * cannot produce and does not offer to end.
   */
  endsAt: z.string().datetime({ message: "An end date is required" }),
  source: z.enum(["coupon", "trial", "manual"]).default("manual"),
  couponCode: z.string().trim().min(1).nullable().default(null),
  reason: z.string().trim().max(500).default(""),
});

const revokeSchema = z.object({
  waiverId: z.string().min(1, "Waiver is required"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const caller = await verifySuperAdmin(request.headers.get("authorization"));
    const { id: tenantId } = await params;

    const validation = createSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    if (!(await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).get()).exists) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const { endsAt, source, couponCode, reason } = validation.data;
    const end = new Date(endsAt);
    const now = new Date();

    // A window that has already closed would be written, resolve to
    // inactive, and leave whoever created it wondering why nothing changed.
    if (end.getTime() <= now.getTime()) {
      return NextResponse.json(
        { success: false, error: "End date must be in the future" },
        { status: 400 }
      );
    }

    const ref = await adminDb
      .collection(TENANT_COLLECTIONS.feeWaivers(tenantId))
      .add({
        startsAt: now,
        endsAt: end,
        source,
        couponCode,
        reason,
        grantedBy: caller.uid,
        revokedAt: null,
        createdAt: now,
      });

    return NextResponse.json({ success: true, data: { id: ref.id } });
  } catch (error) {
    console.error("POST waiver error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    const { id: tenantId } = await params;

    const validation = revokeSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const ref = adminDb
      .collection(TENANT_COLLECTIONS.feeWaivers(tenantId))
      .doc(validation.data.waiverId);

    if (!(await ref.get()).exists) {
      return NextResponse.json(
        { success: false, error: "Waiver not found" },
        { status: 404 }
      );
    }

    await ref.update({ revokedAt: new Date() });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE waiver error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
