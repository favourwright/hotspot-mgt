import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { createHotspotUser } from "@/lib/mikrotik";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";

const retrySchema = z.object({
  voucherId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    // Verify Firebase token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    const decodedToken = await adminAuth.verifyIdToken(token);

    // Verify admin role
    const userDoc = await adminDb
      .collection(COLLECTIONS.USERS)
      .doc(decodedToken.uid)
      .get();

    if (!userDoc.exists || userDoc.data()?.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Forbidden: Admin access required" },
        { status: 403 }
      );
    }

    // Validate input
    const body = await request.json();
    const validation = retrySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { voucherId } = validation.data;

    // Fetch voucher
    const voucherDoc = await adminDb
      .collection(COLLECTIONS.VOUCHERS)
      .doc(voucherId)
      .get();

    if (!voucherDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    const voucher = voucherDoc.data();

    if (voucher?.status !== "failed") {
      return NextResponse.json(
        { success: false, error: "Voucher is not in failed status" },
        { status: 400 }
      );
    }

    // Fetch location with router credentials
    const locationDoc = await adminDb
      .collection(COLLECTIONS.LOCATIONS)
      .doc(voucher.locationId)
      .get();

    if (!locationDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const location = locationDoc.data();

    if (!location?.isActive) {
      return NextResponse.json(
        { success: false, error: "Location is not active" },
        { status: 400 }
      );
    }

    // Fetch plan
    const planDoc = await adminDb
      .collection(COLLECTIONS.PLANS)
      .doc(voucher.planId)
      .get();

    if (!planDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    const plan = planDoc.data();

    // Attempt to create hotspot user on MikroTik with EXISTING credentials
    const routerConfig = {
      ip: location.routerIp,
      username: location.routerUsername,
      password: location.routerPassword,
    };

    const mikrotikResult = await createHotspotUser(routerConfig, {
      username: voucher.username,
      password: voucher.password,
      profile: plan?.mikrotikProfile || "",
    });

    if (mikrotikResult.success) {
      // Success - update voucher to active
      await adminDb
        .collection(COLLECTIONS.VOUCHERS)
        .doc(voucherId)
        .update({
          status: "active",
          retryCount: FieldValue.increment(1),
          lastRetryAt: FieldValue.serverTimestamp(),
          failureReason: FieldValue.delete(),
        });

      return NextResponse.json({
        success: true,
        message: "Voucher activated successfully",
      });
    } else {
      // Failed again - update failure info
      await adminDb
        .collection(COLLECTIONS.VOUCHERS)
        .doc(voucherId)
        .update({
          failureReason: mikrotikResult.error || "Unknown error",
          retryCount: FieldValue.increment(1),
          lastRetryAt: FieldValue.serverTimestamp(),
        });

      return NextResponse.json(
        {
          success: false,
          error: mikrotikResult.error || "Failed to create hotspot user",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Voucher retry error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
