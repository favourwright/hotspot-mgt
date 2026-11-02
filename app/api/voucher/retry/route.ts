import { routerLogin } from "@/lib/router-credentials";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import {
  createHotspotUser,
  findHotspotUser,
  resetHotspotUserCounters,
  updateHotspotUser,
} from "@/lib/mikrotik";
import {
  formatRouterExpiryComment,
  routerExpiryComment,
} from "@/lib/hotspot-users";
import { recreateVerdict } from "@/lib/voucher-recreate";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { FieldValue } from "firebase-admin/firestore";
import { notifyVoucherActivated } from "@/lib/notifications";
import { emitVoucherEvents } from "@/lib/webhooks";

const retrySchema = z.object({
  voucherId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

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
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .doc(voucherId)
      .get();

    if (!voucherDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    const voucher = voucherDoc.data();

    if (!voucher) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    // Whether this can be put back is decided by `recreateVerdict`, below,
    // once the router has been asked what it holds. The statuses that can
    // never be retried are rejected here, before any router call.
    const earlyVerdict = recreateVerdict({
      status: voucher.status,
      isRenewal: Boolean(voucher.renewalOf),
      // Assumed absent, which is the permissive reading: it only ever turns
      // a refusal into "ask the router first", never the other way round.
      onRouter: false,
    });
    if (!earlyVerdict.ok) {
      return NextResponse.json(
        { success: false, error: earlyVerdict.error },
        { status: earlyVerdict.status }
      );
    }

    // Fetch location
    const locationDoc = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(voucher.locationId)
      .get();

    if (!locationDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const location = locationDoc.data();

    if (!location?.active) {
      return NextResponse.json(
        { success: false, error: "Location is not active" },
        { status: 400 }
      );
    }

    // Fetch router credentials via location's routerId
    const routerDoc = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(location.routerId)
      .get();

    if (!routerDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Router not found" },
        { status: 404 }
      );
    }

    const routerData = routerDoc.data()!;

    // Verify router is active
    if (!routerData.active) {
      return NextResponse.json(
        { success: false, error: "Router is not active" },
        { status: 400 }
      );
    }

    // Fetch plan
    const planDoc = await adminDb
      .collection(TENANT_COLLECTIONS.plans(tenantId))
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
      ip: routerData.routerIp,
      ...routerLogin(routerData),
    };

    const isRenewal = Boolean(voucher.renewalOf);
    const wasLive = voucher.status === "active";
    const expiresAt =
      voucher.expiresAt?.toDate?.() ??
      (voucher.expiresAt ? new Date(voucher.expiresAt) : null);

    // What the router holds decides the rest: a renewal still standing on
    // its credential is patched in place, anything missing is created.
    const found = await findHotspotUser(routerConfig, voucher.username);
    if (!found.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Can't reach the router to see whether this login is there. Try again once it's back.",
        },
        { status: 503 }
      );
    }

    const verdict = recreateVerdict({
      status: voucher.status,
      isRenewal,
      onRouter: found.data !== null && found.data !== undefined,
    });
    if (!verdict.ok) {
      return NextResponse.json(
        { success: false, error: verdict.error },
        { status: verdict.status }
      );
    }

    let mikrotikResult;

    if (verdict.mode === "patch") {
      // `found.data` is implied by the verdict; the real condition here is a
      // renewal with no stored `expiresAt`, which means the figure this
      // patch would write is the one thing it must never guess. The
      // reachable half of the old message - the login having gone - is now
      // handled by creating it again instead.
      if (!expiresAt || !found.data) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This renewal has no end date recorded, so topping the login up again would have to guess at one. Sell a new voucher instead.",
          },
          { status: 400 }
        );
      }

      const comment = formatRouterExpiryComment(expiresAt, found.data.comment);
      if (!comment) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This renewal cannot be retried automatically - the login's expiry on the router is in a format we cannot safely rewrite.",
          },
          { status: 400 }
        );
      }

      const patch: Record<string, string> = {
        comment,
        "limit-bytes-total": String(voucher.dataLimitBytes ?? 0),
      };
      if (plan?.mikrotikProfile) {
        patch.profile = plan.mikrotikProfile;
      }
      if (found.data["limit-uptime"] === "1s") {
        patch["limit-uptime"] = "0";
      }

      mikrotikResult = await updateHotspotUser(
        routerConfig,
        voucher.username,
        patch
      );

      // A renewal made under `renewalDataMode: "reset"` is only half
      // applied by the cap above: RouterOS measures lifetime counters
      // against it, so without clearing them the customer arrives at a
      // fresh allowance with whatever they had already spent still against
      // it. The mode is read off the voucher rather than off the tenant,
      // because this retry has to repeat what that renewal decided, not
      // what the setting happens to say today.
      if (mikrotikResult.success && voucher.renewal?.dataMode === "reset") {
        const cleared = await resetHotspotUserCounters(
          routerConfig,
          voucher.username
        );
        if (!cleared.success) {
          console.warn("Retried renewal could not reset data counters:", {
            voucherId,
            username: voucher.username,
            error: cleared.error,
          });
        }
      }
    } else {
      // The comment is the router's only record of when this voucher ends,
      // so a login being put back has to carry the date it was sold with.
      // Recreating it as `vc` would restart the clock at the customer's
      // next login and hand them a fresh full term, and the platform's own
      // `expiresAt` would then disagree with the router for the rest of the
      // plan - which is the drift this view exists to report.
      //
      // `vc` stays right for a voucher that never started: no expiry has
      // been stamped yet, and the profile's on-login script is what starts
      // the clock.
      //
      // The cap comes off the voucher rather than the plan for the same
      // reason: a renewal's allowance is everything it topped up, not one
      // plan's worth.
      mikrotikResult = await createHotspotUser(routerConfig, {
        username: voucher.username,
        password: voucher.password,
        profile: plan?.mikrotikProfile || "",
        comment: expiresAt ? routerExpiryComment(expiresAt) : "vc",
        dataLimit: plan?.dataLimit,
        dataLimitBytes:
          typeof voucher.dataLimitBytes === "number"
            ? voucher.dataLimitBytes
            : undefined,
      });
    }

    if (mikrotikResult.success) {
      // Success - update voucher to active
      await adminDb
        .collection(TENANT_COLLECTIONS.vouchers(tenantId))
        .doc(voucherId)
        .update({
          status: "active",
          retryCount: FieldValue.increment(1),
          lastRetryAt: FieldValue.serverTimestamp(),
          failureReason: FieldValue.delete(),
          // Cleared, or the reconciliation view goes on treating this login
          // as one the reaper removed on purpose and hides the very row the
          // owner just fixed (lib/hotspot-users.ts skips a reaped voucher).
          routerUserReapedAt: FieldValue.delete(),
        });

      // A renewal that lands on the retry still has to close out the
      // voucher it replaced, which the first attempt never got to. Without
      // this the old document stays "active" and the expiry cron emails the
      // customer about an end date that no longer applies.
      if (isRenewal && voucher.renewalOf) {
        await adminDb
          .collection(TENANT_COLLECTIONS.vouchers(tenantId))
          .doc(voucher.renewalOf)
          .update({
            status: "superseded",
            supersededAt: FieldValue.serverTimestamp(),
            supersededBy: voucherId,
          });
      }

      // Delivers the credentials that could not reach the customer the first
      // time round - the whole point of the retry from their side.
      await notifyVoucherActivated({
        tenantId,
        customerEmail: voucher.userEmail,
        planName: voucher.planName,
        locationName: voucher.locationName,
        username: voucher.username,
        password: voucher.password,
        duration: voucher.duration,
        dataLimit: voucher.dataLimit,
        sharedUsers: voucher.sharedUsers,
      });

      // The tenant's webhooks heard "voucher.failed" at the sale; now it
      // works. Never fails the retry (lib/webhooks.ts).
      //
      // Skipped for a voucher that was already live, because that sale
      // emitted its event at the time and nothing downstream is holding a
      // failure to correct. Re-sending would have a tenant's integration
      // count one purchase twice.
      if (!wasLive) {
        await emitVoucherEvents({
          tenantId,
          voucherId,
          type: isRenewal ? "voucher.renewed" : "voucher.issued",
          paymentDocId: null,
        });
      }

      return NextResponse.json({
        success: true,
        message: "Voucher activated successfully",
      });
    } else {
      // Failed again - update failure info.
      //
      // Only for a voucher that was already in the Failed Queue. Stamping a
      // `failureReason` on a live sale because putting its login back did
      // not work would describe the sale as broken when what failed was the
      // repair; the error goes back to the caller either way.
      if (!wasLive) {
        await adminDb
          .collection(TENANT_COLLECTIONS.vouchers(tenantId))
          .doc(voucherId)
          .update({
            failureReason: mikrotikResult.error || "Unknown error",
            retryCount: FieldValue.increment(1),
            lastRetryAt: FieldValue.serverTimestamp(),
          });
      }

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
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
