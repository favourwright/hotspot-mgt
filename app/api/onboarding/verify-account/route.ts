import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { randomUUID } from "crypto";
import { knomadPay } from "@/lib/knomad-pay";

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

    // A name enquiry through Knomad Pay (free at Monnify): the holder's name as their
    // bank has it, which the payee is later checked against.
    const result = await knomadPay().resolveAccount(
      { accountNumber, bankCode },
      { idempotencyKey: `resolve:${randomUUID()}` }
    );
    if (!result.ok) {
      const unresolvable = result.code === "ACCOUNT_UNRESOLVABLE";
      return NextResponse.json(
        {
          success: false,
          error: unresolvable
            ? "We couldn't find that account at that bank. Check the number and the bank."
            : "We couldn't check the account just now. Please try again.",
        },
        { status: unresolvable ? 400 : 502 }
      );
    }
    return NextResponse.json({
      success: true,
      data: { accountName: result.data.accountName, accountNumber: result.data.accountNumber },
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
