import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { PLANS_COLLECTION, USERS_COLLECTION } from "@/lib/firebase-collections";
import { z } from "zod";

const createPlanSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  locationName: z.string().min(1, "Location name is required"),
  name: z.string().min(2, "Plan name must be at least 2 characters"),
  price: z.number().min(1, "Price must be greater than 0"),
  duration: z.string().min(1, "Duration is required"),
  routerDuration: z.string().min(1, "Router duration is required"),
  dataLimit: z.string().min(1, "Data limit is required"),
  mikrotikProfile: z.string().min(1, "MikroTik profile is required"),
  active: z.boolean().default(true),
  sameCredentials: z.boolean().default(true),
});

async function verifyAdmin(token: string) {
  const decodedToken = await adminAuth.verifyIdToken(token);
  const userDoc = await adminDb
    .collection(USERS_COLLECTION)
    .doc(decodedToken.uid)
    .get();

  if (!userDoc.exists || userDoc.data()?.role !== "admin") {
    throw new Error("Unauthorized: Admin access required");
  }

  return decodedToken;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    await verifyAdmin(token);

    // Get locationId filter from query params
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    let query = adminDb.collection(PLANS_COLLECTION).orderBy("createdAt", "desc");

    if (locationId) {
      query = query.where("locationId", "==", locationId) as FirebaseFirestore.Query;
    }

    const plansSnapshot = await query.get();

    const plans = plansSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        locationId: data.locationId,
        locationName: data.locationName,
        name: data.name,
        price: data.price,
        duration: data.duration,
        routerDuration: data.routerDuration,
        dataLimit: data.dataLimit,
        mikrotikProfile: data.mikrotikProfile,
        active: data.active,
        sameCredentials: data.sameCredentials ?? true, // Default to true for existing plans
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    });

    return NextResponse.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error("GET plans error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    await verifyAdmin(token);

    const body = await request.json();
    const validationResult = createPlanSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const planData = validationResult.data;

    // Create plan document
    const planRef = await adminDb.collection(PLANS_COLLECTION).add({
      ...planData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const planDoc = await planRef.get();
    const data = planDoc.data();

    return NextResponse.json({
      success: true,
      data: {
        id: planRef.id,
        ...data,
        createdAt: data?.createdAt?.toDate?.()?.toISOString(),
        updatedAt: data?.updatedAt?.toDate?.()?.toISOString(),
      },
    });
  } catch (error) {
    console.error("POST plan error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
