import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { ADDON_CATALOG, ADDON_KEYS, isAddonKey } from "@/lib/addon-catalog";
import { getAllAddons, upsertAddon } from "@/lib/addons";

export const dynamic = "force-dynamic";

const UpsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(""),
  pricingModel: z.enum(["free", "one_time", "subscription"]),
  // Kobo. Validated here rather than only in the UI, because this route is
  // what actually decides what a tenant is charged.
  amount: z.number().int().nonnegative().max(100_000_000),
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const PatchSchema = z
  .record(z.string(), UpsertSchema)
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
      // everything, which is worse than refusing to save.
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
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
