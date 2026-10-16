import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { getTenantBySlug, getVoucherCredential } from "@/lib/firestore-helpers";
import {
  generateHandleSuffix,
  normaliseHandle,
  routerUsernameFor,
  validateHandle,
  validateVoucherPassword,
} from "@/lib/voucher-credentials";

/**
 * A customer's own voucher username and password at one tenant.
 *
 * Both methods act on the caller's own record and nobody else's: the
 * document id is the verified uid from the token, never anything from the
 * URL or the body. There is deliberately no way to ask about another
 * customer's credentials, and no "is this name available" endpoint - the
 * suffix in `routerUsernameFor` is what removes the need for one, and an
 * availability check would be an enumeration oracle for a login that has no
 * rate limiting behind it. See lib/voucher-credentials.ts.
 */

const saveSchema = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});

async function resolveTenantId(slug: string): Promise<string | null> {
  const tenant = await getTenantBySlug(slug);
  return tenant?.id ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const verifiedUser = await verifyAuthenticated(
      request.headers.get("authorization")
    );

    const { slug } = await params;
    const tenantId = await resolveTenantId(slug);
    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: "Business not found" },
        { status: 404 }
      );
    }

    const credential = await getVoucherCredential(tenantId, verifiedUser.uid);

    return NextResponse.json({
      success: true,
      data: credential
        ? {
            handle: credential.handle,
            // The full name, assembled here rather than in the browser, so
            // one function owns the format and the page cannot drift from
            // what actually gets written to the router.
            username: routerUsernameFor(credential.handle, credential.suffix),
            password: credential.password,
          }
        : null,
    });
  } catch (error) {
    console.error("Voucher credential read error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const verifiedUser = await verifyAuthenticated(
      request.headers.get("authorization")
    );

    const { slug } = await params;
    const tenantId = await resolveTenantId(slug);
    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: "Business not found" },
        { status: 404 }
      );
    }

    const validation = saveSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const handle = normaliseHandle(validation.data.handle);
    const { password } = validation.data;

    // Re-run on the server, not only in the form. The rules here are the
    // only ones that hold: a password equal to the username is a real
    // hotspot takeover on a login with no lockout, and client-side
    // validation is a convenience, never a control.
    const handleCheck = validateHandle(handle);
    if (!handleCheck.ok) {
      return NextResponse.json(
        { success: false, error: handleCheck.error },
        { status: 400 }
      );
    }

    const passwordCheck = validateVoucherPassword(password, {
      handle,
      email: verifiedUser.email,
    });
    if (!passwordCheck.ok) {
      return NextResponse.json(
        { success: false, error: passwordCheck.error },
        { status: 400 }
      );
    }

    // Generated once and kept forever after. Rotating it would change the
    // customer's username behind their back, which is the one outcome this
    // whole feature exists to prevent.
    const existing = await getVoucherCredential(tenantId, verifiedUser.uid);
    const suffix = existing?.suffix ?? generateHandleSuffix();

    await adminDb
      .collection(TENANT_COLLECTIONS.voucherCredentials(tenantId))
      .doc(verifiedUser.uid)
      .set(
        {
          handle,
          suffix,
          password,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return NextResponse.json({
      success: true,
      data: {
        handle,
        username: routerUsernameFor(handle, suffix),
        password,
      },
    });
  } catch (error) {
    console.error("Voucher credential save error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
