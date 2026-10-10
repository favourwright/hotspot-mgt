import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { ADDON_CATALOG, ADDON_KEYS, isAddonKey } from "@/lib/addon-catalog";
import { getAllAddons, upsertAddon, ensureAddonPlanCode } from "@/lib/addons";
import { UpdateAddonInputSchema } from "@/types/schemas";

export const dynamic = "force-dynamic";

// Keyed by addon, so the page can save one row or several. Unknown keys are
// rejected rather than ignored: a typo would otherwise write a document that
// no gate will ever read.
const PatchSchema = z
  .record(z.string(), UpdateAddonInputSchema)
  .refine(
    (value) => Object.keys(value).every(isAddonKey),
    "Unknown addon key - it must exist in lib/addon-catalog.ts"
  );

export async function GET(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));

    return NextResponse.json({
      success: true,
      data: {
        addons: await getAllAddons(),
        // What each key actually gates, straight from the code, so the page
        // can show the blast radius of making something paid.
        catalog: ADDON_KEYS.map((key) => ({ key, ...ADDON_CATALOG[key] })),
      },
    });
  } catch (error) {
    console.error("List addons error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));

    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Invalid" },
        { status: 400 }
      );
    }

    for (const [key, input] of Object.entries(parsed.data)) {
      if (!isAddonKey(key)) continue;

      // A paid addon with no price would charge nothing and grant
      // everything, which is worse than refusing to save it.
      if (input.pricingModel !== "free" && input.amount <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: `"${input.name}" is paid but has no price set.`,
          },
          { status: 400 }
        );
      }

      await upsertAddon(key, input);

      // Keep Paystack in step with the new price, the same way the billing
      // plan route does. Reported rather than thrown: the Plan is also
      // repaired lazily by ensureAddonPlanCode at checkout, so a Paystack
      // outage here must not lose the superadmin's edit.
      if (input.pricingModel === "subscription") {
        try {
          await ensureAddonPlanCode(key);
        } catch (error) {
          console.error(`Addon ${key} Paystack sync failed:`, error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { addons: await getAllAddons() },
    });
  } catch (error) {
    console.error("Update addons error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
