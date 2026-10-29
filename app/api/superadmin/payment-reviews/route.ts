/**
 * Paid charges that fulfilment could not honour, and the two ways a person
 * resolves one. Superadmin only. See lib/payment-reviews.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import {
  ReviewError,
  fulfilReviewedPayment,
  listPaymentReviews,
  markReviewRefunded,
} from "@/lib/payment-reviews";

const actionSchema = z.object({
  reference: z.string().min(1),
  action: z.enum(["fulfil", "refunded"]),
  note: z.string().trim().max(500).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    return NextResponse.json({ success: true, data: await listPaymentReviews() });
  } catch (error) {
    console.error("List payment reviews error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifySuperAdmin(request.headers.get("authorization"));

    const validation = actionSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }
    const { reference, action } = validation.data;
    const note = validation.data.note || null;
    const resolvedBy = user.email || user.uid;

    if (action === "fulfil") {
      const result = await fulfilReviewedPayment({ reference, note, resolvedBy });
      return NextResponse.json({ success: true, data: result });
    }

    await markReviewRefunded({ reference, note, resolvedBy });
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    if (error instanceof ReviewError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("Payment review action error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
