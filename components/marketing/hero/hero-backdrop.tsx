import { DITHER } from "@/components/marketing/field";
import { GradientField } from "@/components/marketing/gradient-field";

/**
 * The hero's background: a slow field of soft bodies drifting behind the
 * headline.
 *
 * Still a server component with no JavaScript of its own. Three separate
 * systems move these layers and none of them lives here:
 *
 * - **Ambient drift** is CSS keyframes, keyed off `data-drift` and defined
 *   in `landing.css`. Transform-only, so it runs on the compositor.
 * - **Pointer parallax** is the `translate` property, reading the damped
 *   `--pointer-x` / `--pointer-y` that `usePointerField` publishes on the
 *   hero once per frame.
 * - **The scroll settle** is a scrubbed ScrollTrigger in `HeroMotion`,
 *   applied to the `data-field` wrapper rather than to any body.
 *
 * Those three compose cleanly because CSS keeps `translate` and
 * `transform` as separate properties that multiply, and because the scroll
 * owns a different element entirely. Nothing has to arbitrate.
 *
 * Why rigid ellipses rather than a real metaball: the merge-and-split look
 * needs a blur-and-contrast filter over the whole area, and a filtered
 * region repaints in full on every frame anything inside it moves. Several
 * overlapping bodies produce a combined silhouette that swells and pinches
 * convincingly for the cost of a transform. See `landing.css`.
 *
 * ## Why it is a blurred field of circles
 *
 * Earlier versions built the field from a few large gaussian bodies and
 * banded persistently - five passes of smoothstep ramps, gaussian
 * falloffs and dithering never fixed it. `gradient-field.tsx` explains
 * the change in full; the short version is that blur happens after
 * rasterization, so it removes quantization steps where dither can only
 * mask them.
 *
 * The palette stays inside the primary family and, now, within a narrow
 * lightness range. The previous version had a near-white body in among
 * deep crimson ones, and that contrast alone was enough to make it read as
 * a separate object rather than part of a field.
 *
 * ## Keeping it punchy
 *
 * The first thing a visitor sees should not read as dull, so the whole
 * stack is tuned to hold chroma: the base ramp ends on a brand-tinted
 * deep wine (`--field-deep`) instead of slate, so no midpoint passes
 * through grey; the field is allowed to reach further down the hero; and
 * the grain is kept light, since a normal-blend grey pulls everything
 * under it toward mid-grey.
 */

/**
 * A ramp whose derivative is continuous, sampled from smoothstep.
 *
 * A three-stop gradient has a corner in its first derivative at the
 * midpoint, and the eye is far more sensitive to a discontinuity in the
 * rate of change than to the step itself - it shows as a hard line
 * through an otherwise smooth ramp at amplitudes well under one 8-bit
 * level. `t^2 * (3 - 2t)` has zero slope at both ends, so a ramp built
 * from these samples also joins the flat regions either side without a
 * kink.
 */
const SMOOTHSTEP = [0, 0.043, 0.1563, 0.3164, 0.5, 0.6836, 0.8438, 0.957, 1];

function smoothRamp(
  fromPercent: number,
  toPercent: number,
  at: (t: number) => string
) {
  const span = toPercent - fromPercent;
  return SMOOTHSTEP.map((t, index) => {
    const position = fromPercent + (span * index) / (SMOOTHSTEP.length - 1);
    return `${at(t)} ${position.toFixed(2)}%`;
  }).join(", ");
}

const SURFACE = "var(--surface-canvas)";

/**
 * Where the base ramp ends up. A deep, saturated brand shade rather than
 * `--foreground`: pale slate to dark slate is a trip between two
 * low-chroma colours, so every midpoint is a grey. Ending on a chromatic
 * colour keeps the middle of the ramp coloured.
 */
const END = "var(--field-deep)";

/**
 * The single vertical journey from pale surface to deep brand colour,
 * opaque the whole way.
 *
 * The stops are set against where the text actually sits rather than by
 * eye. The CTA row bottoms out around 60% of the hero and the footer strip
 * starts around 80%, so the ramp has to be finished inside that gap.
 * Spreading it wider, which is the instinct, is what produced a long grey
 * nothing through the middle.
 */
const BASE = [
  "linear-gradient(to bottom in oklab",
  `${SURFACE} 0%`,
  smoothRamp(
    44,
    86,
    (t) =>
      `color-mix(in oklch, ${SURFACE}, ${END} ${(t * 100).toFixed(1)}%)`
  ),
  `${END} 100%)`,
].join(", ");

/**
 * The dither only covers the gradient.
 *
 * A grey grain at a usable amplitude pulls whatever is under it toward
 * mid-grey, which over the flat pale top would be a visible greying of
 * the cleanest part of the hero. That region is a solid colour with no
 * ramp in it, so it has nothing to band and needs no dither at all.
 */
const DITHER_MASK = `linear-gradient(to bottom, transparent 0%, ${smoothRamp(
  24,
  52,
  (t) => `rgba(0,0,0,${t})`
)}, #000 100%)`;

/**
 * Fades the field in below the headline and only partly back out across
 * the floor.
 *
 * The fade-in starts below the support paragraph, not above it. At 34%
 * the field reached up behind that text and took its contrast with it;
 * the CTA row bottoms out around 60%, so starting at 50% keeps the
 * field clear of everything that has to be read.
 *
 * The fade-out used to take the field down to 10% so the footer strip
 * sat on ink, which meant the colourful part of the hero was a narrow
 * band on a dark ground. It now holds about half strength to the bottom,
 * and `FOOTER_SCRIM` below handles legibility for the strip alone.
 */
const FIELD_MASK = `linear-gradient(to bottom, transparent 0%, ${smoothRamp(
  50,
  68,
  (t) => `rgba(0,0,0,${t})`
)}, #000 86%, ${smoothRamp(86, 100, (t) => `rgba(0,0,0,${1 - t * 0.5})`)})`;

/**
 * Darkens the footer strip only, so white text there keeps its contrast
 * without the whole lower hero being pulled back to ink. Static, and it
 * sits inside the area the dither mask already covers.
 */
const FOOTER_SCRIM =
  "linear-gradient(to top, rgb(0 0 0 / 0.45), transparent 22%)";

export function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-surface"
    >
      {/*
        The base. Pale at the top is deliberately neither white nor the
        canvas tint but between them: pure white leaves the white nav bar
        invisible against it, and the plain tint makes the container's top
        edge vanish into the page.
      */}
      <div className="absolute inset-0" style={{ background: BASE }} />

      {/*
        The field. One wrapper so the scroll settle has a single element
        to move; what is inside it is `GradientField`'s business.

        The mask fades it out before it reaches the headline, replacing
        what used to be a scrim layer painted on top - a scrim was
        another full-height translucent layer over the base, quantizing
        the ramp a second time.

        The pointer parallax lives here too, on the wrapper rather than
        on each circle: the circles sit inside a blurred stage, and
        moving them individually would re-run the filter for no visible
        benefit at this blur radius.
      */}
      <div
        data-field
        className="absolute inset-0"
        style={{
          maskImage: FIELD_MASK,
          // Safari carried the prefixed property for a long time and
          // still honours it. One extra declaration is cheaper than the
          // failure mode, which is the mask being ignored entirely and
          // the field washing straight over the headline.
          WebkitMaskImage: FIELD_MASK,
          translate:
            "calc(var(--pointer-x, 0) * 1.5rem) calc(var(--pointer-y, 0) * 0.75rem)",
        }}
      >
        {/*
          A smaller blur than the default keeps more peak intensity and
          gives the bodies more definition; the saturate is a light touch
          on the filter the stage already pays for. `--field-core` is
          already at the gamut edge, so anything stronger just clips.
          Check the lower half for banding after changing either.
        */}
        <GradientField
          seed={7}
          count={18}
          from={20}
          to={98}
          blur={6}
          saturate={1.15}
        />
      </div>

      {/* Footer strip legibility. See `FOOTER_SCRIM`. */}
      <div className="absolute inset-0" style={{ background: FOOTER_SCRIM }} />

      {/*
        The dither. Static, painted once, never animated, so it carries
        none of the per-frame cost that ruled blending out for the bodies.

        Normal blending, NOT `overlay`, and that is the whole point of this
        layer working. Overlay's output scales with the backdrop: against
        something dark it multiplies, so the noise amplitude collapses with
        the luminance it is sitting on. Measured on the previous version it
        was 4.4 levels over the pale top and 0.3 over the ink, a 12x drop,
        which left the entire lower half effectively undithered. The bands
        were worst exactly where the glow moved away and exposed the bare
        ramp, and moving contours are much easier to see than static ones.

        Plain alpha has constant amplitude at every luminance, which is
        what dither actually needs. The cost is that it lifts the deepest
        ink by roughly `opacity x noise-mean`, a handful of levels, and
        that it pulls colour toward grey. The opacity is therefore kept as
        low as banding allows: the field is blurred and smoother now, so
        it needs less than it used to. If bands come back, raise it in
        steps of 0.01.
      */}
      <div
        className="absolute inset-0"
        // The mask lives on the outer element so its percentages stay
        // relative to the hero. The grain itself is a child, oversized so
        // that jittering it never exposes an edge.
        style={{
          maskImage: DITHER_MASK,
          WebkitMaskImage: DITHER_MASK,
          // The grain child overflows this box by 260px. `mask-repeat`
          // defaults to `repeat`, which would tile the ramp and un-hide
          // that overflow straight over the headline. With `no-repeat`,
          // anything outside the mask image is alpha 0 and stays hidden.
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
        }}
      >
        <div
          data-grain
          className="absolute -inset-[260px] opacity-[0.06]"
          style={{ backgroundImage: DITHER, backgroundSize: "200px 200px" }}
        />
      </div>
    </div>
  );
}