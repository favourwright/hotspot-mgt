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
 * ## The artwork is not identical to what was served before
 *
 * It is byte-identical to the hosted API's **9.x** endpoint, which is
 * the generation these style libraries belong to. The app was calling
 * **10.x**, and 10.x draws different art for the same seed: different
 * colours and features on a face, a different composition of shapes.
 * There is no 10.x style library published, so matching it is not
 * available at any price.
 *
 * For user avatars this is moot, because the seed changed from the email
 * address to the account id in the same change and every face was going
 * to be different regardless. For brand icons the seed did not change,
 * so every tenant's icon is a different arrangement than it was. They
 * are decorative and seeded, nobody chose theirs, and it is a one-time
 * change rather than a drifting one.
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
 * The brand style used to be requested with `tags=animation`. That is a
 * feature of the hosted 10.x endpoint rather than an option on the style,
 * so it is not in this schema and cannot be passed here. It is restored
 * separately by `SHAPES_ANIMATION` below.
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

/**
 * The brand icon's gentle sway, restored.
 *
 * The hosted API was being called with `tags=animation`, which only its
 * 10.x endpoint implements and only for this style. The published style
 * libraries stop at 9.x and have no equivalent, so moving generation
 * in-house dropped it. This puts it back.
 *
 * ## Why it is a stylesheet and not a change to the markup
 *
 * Nothing above is rewritten. The generated document is used exactly as
 * the library produced it and this is inserted after its opening tag, so
 * there is no parsing of generated markup and nothing to corrupt. If a
 * future version of the style nests its shapes differently the selectors
 * stop matching and the icon is simply still, which is the right way for
 * decoration to fail.
 *
 * ## Why it animates `rotate` and `translate`, not `transform`
 *
 * Each shape group already carries a `transform` attribute holding the
 * matrix that places it. The `transform` attribute and the `transform`
 * CSS property are the same thing, so animating `transform` here would
 * replace that matrix and throw every shape out of position. `rotate`,
 * `translate` and `scale` are separate CSS properties that compose with
 * it instead, which is what lets this sway a shape without knowing or
 * disturbing where the generator put it.
 *
 * `transform-box: fill-box` makes each shape turn about its own centre
 * rather than the centre of the viewBox.
 *
 * The three durations are coprime so the group does not visibly resync.
 * The whole thing sits inside a `prefers-reduced-motion` query, so a
 * visitor who asked for less motion gets the static icon and no
 * animation is ever created to be paused.
 */
const SHAPES_ANIMATION = `<style>
@media (prefers-reduced-motion: no-preference) {
  svg > g[mask] > g { transform-box: fill-box; transform-origin: center; }
  svg > g[mask] > g:nth-of-type(1) { animation: dbSwayA 23s ease-in-out infinite; }
  svg > g[mask] > g:nth-of-type(2) { animation: dbSwayB 18s ease-in-out infinite; }
  svg > g[mask] > g:nth-of-type(3) { animation: dbSwayA 14s ease-in-out infinite; }
  @keyframes dbSwayA {
    0%, 100% { rotate: 0deg; translate: 0 0; scale: 1; }
    33% { rotate: 3.5deg; translate: 1.5px -1px; scale: 1.02; }
    66% { rotate: -2deg; translate: -1px 1px; scale: 0.99; }
  }
  @keyframes dbSwayB {
    0%, 100% { rotate: 0deg; translate: 0 0; scale: 1; }
    33% { rotate: -3.5deg; translate: -1.5px 1px; scale: 0.98; }
    66% { rotate: 2deg; translate: 1px -1px; scale: 1.01; }
  }
}
</style>`;

/**
 * Inserts the stylesheet immediately after the opening `<svg>` tag.
 *
 * Returns the document untouched if that tag is not where it is expected,
 * rather than guessing: a silent no-op that loses an animation is a far
 * better failure than a mangled document, and this is the one place in
 * this file that depends on the shape of someone else's output.
 */
function withAnimation(svg: string): string {
  const openingTag = svg.match(/^<svg[^>]*>/);
  if (!openingTag) return svg;
  return svg.replace(openingTag[0], `${openingTag[0]}${SHAPES_ANIMATION}`);
}

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

  const generated = createAvatar(STYLES[style], {
    seed,
    ...OPTIONS[style],
  }).toString();

  const svg = style === "shapes" ? withAnimation(generated) : generated;

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
