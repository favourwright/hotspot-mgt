/**
 * GET /api/onboarding/banks: the banks a tenant can be paid into, from Knomad Pay
 * (Monnify's list). The code chosen here is the one their payee is made with
 * (lib/knomad-pay-payees.ts), so the list must be the gateway's, not another provider's.
 */
import { NextResponse } from "next/server";
import { knomadPay } from "@/lib/knomad-pay";

export async function GET() {
  try {
    const result = await knomadPay().listBanks();
    if (!result.ok) {
      console.error(`Banks fetch error: ${result.code} ${result.message}`);
      return NextResponse.json({ success: false, error: "Failed to fetch banks" }, { status: 502 });
    }
    return NextResponse.json({ success: true, data: result.data.map((b) => ({ name: b.name, code: b.code })) });
  } catch (error) {
    console.error("Banks fetch error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch banks" }, { status: 500 });
  }
}
