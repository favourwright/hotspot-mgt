/**
 * POST /api/developers/feedback { section, helpful }: a "Was this helpful?"
 * answer from /developers. Public, so rate-limited per address and only for
 * sections that exist (lib/docs-feedback.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { recordDocsFeedback } from "@/lib/docs-feedback";

const bodySchema = z.object({
  section: z.string().min(1).max(100),
  helpful: z.boolean(),
});

export async function POST(request: NextRequest) {
  // Only used as a limiter key, and the limiter's memory is bounded either way.
  const ip = clientIp(request.headers);
  if (!rateLimit(`docsfeedback:${ip}`, { max: 20, windowMs: 60 * 60_000 }).ok) {
    return NextResponse.json({ success: false, error: "Thanks, that's plenty for now." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid feedback" }, { status: 400 });
  }

  try {
    const ok = await recordDocsFeedback(parsed.data.section, parsed.data.helpful);
    if (!ok) return NextResponse.json({ success: false, error: "Unknown section" }, { status: 404 });
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    console.error("[docs] feedback failed:", error);
    return NextResponse.json({ success: false, error: "Could not record that" }, { status: 500 });
  }
}
