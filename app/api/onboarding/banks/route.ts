import { NextResponse } from "next/server";
import { fetchPaystackBanks } from "@/lib/paystack";

export async function GET() {
  try {
    const result = await fetchPaystackBanks();

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Banks fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch banks" },
      { status: 500 }
    );
  }
}
