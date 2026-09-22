import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";

export async function GET(request: NextRequest) {
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

    // Fetch all payments
    const paymentsSnapshot = await adminDb
      .collection(COLLECTIONS.PAYMENTS)
      .where("status", "==", "success")
      .get();

    const totalRevenue = paymentsSnapshot.docs.reduce(
      (sum, doc) => sum + (doc.data().amount || 0),
      0
    );

    // Fetch all vouchers
    const vouchersSnapshot = await adminDb
      .collection(COLLECTIONS.VOUCHERS)
      .get();

    const totalVouchers = vouchersSnapshot.docs.length;
    const failedVouchers = vouchersSnapshot.docs.filter(
      (doc) => doc.data().status === "failed"
    ).length;
    const activeVouchers = vouchersSnapshot.docs.filter(
      (doc) => doc.data().status === "active"
    ).length;

    // Calculate today's stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayVouchers = vouchersSnapshot.docs.filter((doc) => {
      const createdAt = doc.data().createdAt?.toDate();
      return createdAt && createdAt >= todayStart;
    }).length;

    const todayPayments = paymentsSnapshot.docs.filter((doc) => {
      const createdAt = doc.data().createdAt?.toDate();
      return createdAt && createdAt >= todayStart;
    });

    const todayRevenue = todayPayments.reduce(
      (sum, doc) => sum + (doc.data().amount || 0),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        totalRevenue,
        totalVouchers,
        activeVouchers,
        failedVouchers,
        todayVouchers,
        todayRevenue,
        todayPayments: todayPayments.length,
      },
    });
  } catch (error) {
    console.error("Stats fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
