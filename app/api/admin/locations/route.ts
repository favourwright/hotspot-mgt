import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { LOCATIONS_COLLECTION, USERS_COLLECTION } from "@/lib/firebase-collections";
import { z } from "zod";

const createLocationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  routerIp: z
    .string()
    .regex(
      /^(\d{1,3}\.){3}\d{1,3}$/,
      "Invalid IP address format"
    ),
  routerUser: z.string().min(1, "Router username is required"),
  routerPass: z.string().min(1, "Router password is required"),
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

    // Fetch all locations without credentials
    const locationsSnapshot = await adminDb
      .collection(LOCATIONS_COLLECTION)
      .orderBy("createdAt", "desc")
      .get();

    const locations = locationsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        routerIp: data.routerIp,
        active: data.active,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        // NEVER return routerUser or routerPass
      };
    });

    return NextResponse.json({
      success: true,
      data: locations,
    });
  } catch (error) {
    console.error("GET locations error:", error);
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
    const validationResult = createLocationSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const { name, routerIp, routerUser, routerPass } = validationResult.data;

    // Create location document
    const locationRef = await adminDb.collection(LOCATIONS_COLLECTION).add({
      name,
      routerIp,
      routerUser,
      routerPass,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const locationDoc = await locationRef.get();
    const locationData = locationDoc.data();

    return NextResponse.json({
      success: true,
      data: {
        id: locationRef.id,
        name: locationData?.name,
        routerIp: locationData?.routerIp,
        active: locationData?.active,
        createdAt: locationData?.createdAt?.toDate?.()?.toISOString(),
      },
    });
  } catch (error) {
    console.error("POST location error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
