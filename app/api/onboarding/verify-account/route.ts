import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { verifyPaystackAccount } from "@/lib/paystack";

const verifyAccountSchema = z.object({
  accountNumber: z
    .string()
    .min(10)
    .max(10)
    .regex(/^\d+$/),
  bankCode: z.string().min(3),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifyAuthenticated(authHeader);

    const body = await request.json();
    const validation = verifyAccountSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { accountNumber, bankCode } = validation.data;

    const result = await verifyPaystackAccount(accountNumber, bankCode);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Account verify error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
