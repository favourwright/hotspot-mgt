import { NextRequest, NextResponse } from "next/server";
import { createAvatar } from "@dicebear/core";
import * as dylan from "@dicebear/dylan";
import * as shapes from "@dicebear/shapes";

/**
 * Generated avatars, served from our own origin.
 *
 * ## Why this route exists
 *
 * These images used to be `<img src="https://api.dicebear.com/...">`,
 * which made a request from the visitor's browser to a third party on
 * every authenticated page load. That request carried three things:
 *
 * - the seed, which was the user's **email address**, in a URL query
 *   string, where it lands in that host's access logs;
 * - the visitor's IP address;
 * - a `Referer` of the page's origin which, on a tenant subdomain, names
 *   the business that visitor uses.
 *
 * Hashing the seed would have fixed the first of those and left the other
 * two, and a stable seed plus an IP plus an origin is a profile whether
 * the seed is readable or not. Generating the same artwork on our own
 * server removes the request entirely, so there is nothing left to leak
 * and nothing left to disclose in the privacy policy.
 *
 * The output is byte-identical to what the hosted API returned for the
 * same style and seed, because it is the same generator: DiceBear
 * publishes these styles as libraries and the HTTP API is a wrapper
 * around them.
 *
 * ## One thing this route deliberately does not do
 *
 * SVG is a script-bearing format, and one served from our own origin runs
 * in our own origin if a browser navigates to it directly. A per-response
 * `Content-Security-Policy` of `default-src 'none'; sandbox` would be the
 * usual belt, and it is not set here because it would not take effect:
 * `next.config.ts` applies `Content-Security-Policy: frame-ancestors
 * 'self'` to `/:path*`, and that wins. Setting a header here that the
 * platform silently replaces is worse than not setting one, because the
 * next person reads it and believes it.
 *
 * What makes that acceptable today is that these documents contain no
 * script: they are fixed shape templates with seeded colours and offsets,
 * and nothing user-supplied reaches the output except through the
 * generator's own schema. If that ever stops being true, the fix is a
 * route-aware policy in `next.config.ts`, not a header here.
 *
 * ## Attribution
 *
 * `dylan` is dual licensed `MIT AND CC-BY-4.0`: the code is MIT, the
 * artwork is Creative Commons and requires credit. The credit is rendered
 * from the style's own `meta` rather than copied into a string here, so
 * it cannot drift from the package if the package is ever updated. See
 * `lib/avatar-credits.ts`.
 */

/**
 * The styles this route will generate, by name.
 *
 * An allowlist, not a lookup into whatever the URL asked for. The segment
 * is attacker-controlled, and resolving it against anything broader is
 * how a path parameter turns into a module selector.
 */
const STYLES = { dylan, shapes } as const;

type StyleName = keyof typeof STYLES;

function isStyleName(value: string): value is StyleName {
  return Object.hasOwn(STYLES, value);
}

/**
 * Per-style options, matching what the hosted API was being called with
 * so existing avatars do not change appearance.
 *
 * The brand style used to be requested with `tags=animation`. That is not
 * one of its options - the schema has no such property - so it was being
 * ignored, and dropping it changes nothing.
 */
const OPTIONS: Record<StyleName, Record<string, unknown>> = {
  dylan: {
    backgroundColor: ["f4f4f5"],
    hairColor: ["ff2e88", "00e5ff", "7cff00", "ffe600", "b400ff"],
  },
  shapes: {},
};

/** Keeps a malicious or accidental megabyte of seed out of the generator. */
const MAX_SEED_LENGTH = 256;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ style: string }> }
) {
  const { style } = await params;

  if (!isStyleName(style)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const seed = request.nextUrl.searchParams.get("seed")?.slice(0, MAX_SEED_LENGTH);
  if (!seed) {
    return NextResponse.json({ error: "A seed is required" }, { status: 400 });
  }

  const svg = createAvatar(STYLES[style], {
    seed,
    ...OPTIONS[style],
  }).toString();

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // The same seed always produces the same image, so this can be
      // cached for as long as anything is willing to keep it. `immutable`
      // stops the browser revalidating on reload.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
