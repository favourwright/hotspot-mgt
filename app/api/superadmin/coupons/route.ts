/**
 * Promo code CRUD. Superadmin only.
 *
 * Codes are never hard-deleted while they may have been redeemed - a
 * deactivated code still explains why a tenant's fee is waived. Deletion is
 * reserved for one that nobody ever used.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { listCoupons, normalizeCouponCode } from "@/lib/coupons";
import { z } from "zod";

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Code must be at least 3 characters")
    .max(32, "Code must be at most 32 characters")
    .regex(
      /^[A-Za-z0-9-]+$/,
      "Code can only contain letters, numbers and hyphens"
    ),
  description: z.string().trim().max(200).default(""),
  durationDays: z
    .number()
    .int()
    .min(1, "Duration must be at least a day")
    .max(730, "Duration must be at most 730 days"),
  maxRedemptions: z.number().int().positive().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  active: z.boolean().default(true),
});

const updateSchema = z.object({
  code: z.string().min(1),
  description: z.string().trim().max(200).optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    return NextResponse.json({ success: true, data: await listCoupons() });
  } catch (error) {
    console.error("List coupons error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const caller = await verifySuperAdmin(request.headers.get("authorization"));

    const validation = createSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { code, description, durationDays, maxRedemptions, expiresAt, active } =
      validation.data;
    const normalized = normalizeCouponCode(code);
    const ref = adminDb.collection(COLLECTIONS.COUPONS).doc(normalized);

    // The code is the document id, so this is the uniqueness check - no
    // query, no index, and no way for two codes to differ only by case.
    if ((await ref.get()).exists) {
      return NextResponse.json(
        { success: false, error: "That code already exists" },
        { status: 409 }
      );
    }

    const now = new Date();
    await ref.set({
      description,
      durationDays,
      maxRedemptions,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      active,
      timesRedeemed: 0,
      createdBy: caller.uid,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true, data: { code: normalized } });
  } catch (error) {
    console.error("Create coupon error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * Edit a code, or switch it off.
 *
 * `durationDays` is deliberately not editable. Changing it would silently
 * mean two tenants who redeemed the same code got different windows, and the
 * waiver documents already record what each one was actually given. Make a
 * new code instead.
 */
export async function PATCH(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));

    const validation = updateSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { code, ...patch } = validation.data;
    const ref = adminDb
      .collection(COLLECTIONS.COUPONS)
      .doc(normalizeCouponCode(code));

    if (!(await ref.get()).exists) {
      return NextResponse.json(
        { success: false, error: "Coupon not found" },
        { status: 404 }
      );
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.maxRedemptions !== undefined)
      update.maxRedemptions = patch.maxRedemptions;
    if (patch.active !== undefined) update.active = patch.active;
    if (patch.expiresAt !== undefined)
      update.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;

    await ref.update(update);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update coupon error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    if (!code) {
      return NextResponse.json(
        { success: false, error: "Code is required" },
        { status: 400 }
      );
    }

    const ref = adminDb
      .collection(COLLECTIONS.COUPONS)
      .doc(normalizeCouponCode(code));
    const doc = await ref.get();

    if (!doc.exists) {
      return NextResponse.json(
        { success: false, error: "Coupon not found" },
        { status: 404 }
      );
    }

    // A redeemed code is the only record of why somebody's fee is waived.
    // Switching it off stops new redemptions and keeps that record.
    if ((doc.data()?.timesRedeemed ?? 0) > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This code has been redeemed, so it can't be deleted. Deactivate it instead.",
        },
        { status: 409 }
      );
    }

    await ref.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete coupon error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
