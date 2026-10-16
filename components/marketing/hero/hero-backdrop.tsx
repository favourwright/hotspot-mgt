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
 * ## Three things here exist to stop it looking cheap
 *
 * An earlier version banded badly and read as separate discs. All three of
 * the causes were structural, so they are worth stating.
 *
 * **One opaque base, not a stack of translucent ones.** Every translucent
 * layer quantizes to 8 bits per channel, and stacking them quantizes
 * again, so a pale-to-ink ramp built from a solid fill plus a half-opacity
 * ink plus a scrim on top banded three times over. There is now a single
 * opaque gradient doing the whole vertical journey, interpolated in oklab
 * so the perceptual steps are even rather than bunching in the midtones.
 *
 * **Bodies fall off on a curve, not a line.** A two-stop radial from a
 * colour to transparent is a linear alpha ramp, and a linear ramp has a
 * corner in its derivative where it lands. The eye reads that corner as an
 * edge, which is exactly why they looked like discs. `softBody` below
 * spends most of its stops in the tail approximating a gaussian, so there
 * is no point along the radius where the rate of change jumps.
 *
 * **It is dithered.** Banding is quantization, and the standard answer to
 * quantization is dither: a little noise moves each pixel across the
 * decision boundary at a slightly different place, which turns a hard
 * contour into imperceptible grain. One static tiled layer, painted once.
 *
 * The palette stays inside the primary family and, now, within a narrow
 * lightness range. The previous version had a near-white body in among
 * deep crimson ones, and that contrast alone was enough to make it read as
 * a separate object rather than part of a field.
 */

/**
 * The alpha curve every body fades along: a real gaussian, sampled.
 *
 * The previous version hand-wrote six stops and ended on
 * `alpha 0.08 -> 0`, which lands with appreciable slope. Outside the
 * gradient's last stop the alpha is flat zero, so that terminus is a
 * derivative discontinuity, and the eye reads a discontinuity in the rate
 * of change as a line. Two of the five bodies happened to have their outer
 * edge at almost the same height, which is why there were exactly two
 * bands, and why they tracked the pointer: the bodies move, so their edges
 * move with them.
 *
 * A true gaussian never reaches zero, which is precisely why it has no
 * edge. A CSS gradient has to terminate, so the trick is to put the
 * terminus far enough out along the curve that the slope there is
 * effectively nil. At `t = 1` this sits at alpha 0.0006, and the final
 * segment's slope is about 0.25% of the curve's steepest - four hundred
 * times flatter than the version that banded.
 *
 * The cost is that the declared radius no longer matches the visible one.
 * Alpha passes 0.1 at roughly 0.56 of the declared radius, so every size
 * below is scaled up by about 1.47 to keep the composition it had.
 */
const BODY_FALLOFF = (() => {
  const SAMPLES = 16;
  const SIGMA = 0.26;
  const stops: Array<[number, number]> = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const t = i / (SAMPLES - 1);
    stops.push([t * 100, Math.exp(-(t * t) / (2 * SIGMA * SIGMA))]);
  }
  // Land exactly on zero. The residual it discards is 0.0006 of full
  // alpha, spread over the last segment, which is far below one 8-bit
  // level and so cannot itself band.
  stops[stops.length - 1][1] = 0;
  return stops;
})();

/**
 * A radial body with that falloff.
 *
 * Every stop fades toward the body's OWN colour at zero alpha rather than
 * the `transparent` keyword, which is transparent black.
 *
 * `peak` is the body's overall strength, folded into the stops rather than
 * set as an `opacity` on the element. That is not a tidiness point. CSS
 * `opacity` is a separate compositing step: the gradient is rasterized to
 * 8 bits, then multiplied, then composited, so it quantizes twice. Folding
 * it into the colours leaves one rasterization, and the quantization steps
 * inside the falloff - the concentric rings - get correspondingly smaller.
 */
function softBody(color: string, size: string, at: string, peak: number) {
  const ramp = BODY_FALLOFF.map(
    ([position, alpha]) =>
      `color-mix(in oklch, ${color}, transparent ${((1 - alpha * peak) * 100).toFixed(2)}%) ${position.toFixed(1)}%`
  ).join(", ");

  return `radial-gradient(${size} at ${at}, ${ramp})`;
}

const PRIMARY = "var(--primary)";
const lighter = (percent: number) =>
  `color-mix(in oklch, var(--primary), white ${percent}%)`;
const deeper = (percent: number) =>
  `color-mix(in oklch, var(--primary), var(--foreground) ${percent}%)`;

/**
 * The composition, as data.
 *
 * `drift` keys into the keyframes in `landing.css`. Bodies `d` and `e` are
 * dropped below `md` there, so the two listed last are the two the small
 * layout can afford to lose: the tight core and the floor smear, neither
 * of which carries the composition on its own.
 */
const BODIES = [
  // Large, deepest, left of centre. Carries the bulk of the colour.
  {
    drift: "a",
    gradient: softBody(PRIMARY, "47% 53%", "27% 81%", 0.9),
    parallax: [2.5, 1.25],
  },
  // Mid, lifted, centre. Reads as the one nearest the surface.
  {
    drift: "b",
    gradient: softBody(lighter(22), "35% 41%", "55% 88%", 0.8),
    parallax: [-1.9, -1.1],
  },
  // Right, and deliberately still colourful. An earlier version mixed this
  // one well toward the foreground to push it back, which just left a grey
  // hole in the right half: on an ink field, "darker" reads as the absence
  // of a body rather than as a body further away. Depth here comes from
  // size and opacity, not from desaturation.
  {
    drift: "c",
    gradient: softBody(deeper(10), "44% 50%", "75% 78%", 0.85),
    parallax: [1.6, -0.8],
  },
  // The tight core, which stops the field reading as uniformly soft and
  // gives the eye something to land on. Kept close in lightness to its
  // neighbours: at near-white it stopped being a bright part of the field
  // and became a separate disc sitting on top of it.
  {
    drift: "d",
    gradient: softBody(lighter(38), "21% 26%", "43% 74%", 0.55),
    parallax: [-2.4, 1],
  },
  // A wide, low smear tying the others into the floor.
  {
    drift: "e",
    gradient: softBody(lighter(10), "68% 32%", "60% 97%", 0.5),
    parallax: [1, -1.6],
  },
] as const;

/**
 * A ramp whose derivative is continuous, sampled from smoothstep.
 *
 * This is the single most important function in the file, and its absence
 * was a real defect. A three-stop gradient - start, a midpoint, end - has
 * a corner in its first derivative at that midpoint, and the eye is far
 * more sensitive to a discontinuity in the rate of change than to the step
 * itself. It shows up as a hard line through an otherwise smooth ramp,
 * a Mach band, at amplitudes well under one 8-bit level, which is why no
 * amount of dithering removes it: there is nothing to dither, the ramp is
 * genuinely kinked.
 *
 * Two mask ramps built that way put exactly two such lines across the
 * hero. They were most obvious with the pointer near the bottom, because
 * that slides the bright bodies underneath them and moving contours are
 * much easier to see than still ones.
 *
 * `t^2 * (3 - 2t)` has zero slope at both ends, so a ramp built from these
 * samples also joins the flat regions either side of it without a kink.
 * Nine samples is enough that the residual error between them is far below
 * one level.
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

const SURFACE =
  "color-mix(in oklch, var(--surface-raised), var(--surface-canvas) 55%)";

/**
 * The single vertical journey from pale surface to ink, opaque the whole
 * way.
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
      `color-mix(in oklch, ${SURFACE}, var(--foreground) ${(t * 100).toFixed(1)}%)`
  ),
  "var(--foreground) 100%)",
].join(", ");

/**
 * Tiling greyscale noise, as an inline SVG so it costs no request and no
 * binary asset. `stitchTiles` is what makes the tile seamless; without it
 * the seams are a worse artefact than the banding this is here to remove.
 *
 * The `feColorMatrix` is the part that earns its place, and the first
 * version got it wrong. `feTurbulence` emits noise on all four channels,
 * alpha included, so desaturating alone leaves a layer whose *coverage*
 * varies as well as its colour. Composited, that is not a dither: it is a
 * semi-random dark veil, which measured as a 10-level darkening of the
 * midtones while contributing almost no usable noise amplitude.
 *
 * The matrix below puts the noise luminance into RGB and pins alpha to a
 * constant 1. The layer is then a flat sheet of grey grain at a known
 * opacity, which is what actually perturbs values across the quantization
 * boundary.
 *
 * Two more details, both of which measurably mattered:
 *
 * - `color-interpolation-filters='sRGB'`. Chrome defaults SVG filters to
 *   linearRGB, which compresses the noise around mid-grey and threw away
 *   most of its amplitude before it ever reached the page.
 * - The `feComponentTransfer` expands what is left. `fractalNoise` is
 *   smooth and low-contrast by design, so without a slope on it the layer
 *   needs an opacity high enough to visibly grey the artwork before the
 *   grain is strong enough to break a band. Expanding the noise instead
 *   keeps the opacity, and therefore the colour shift, small.
 *
 * Both transfer stops are centred so that an input of 0.5 maps to 0.5.
 * That is what makes this a dither rather than a veil: the layer's mean is
 * neutral, so it perturbs values without pulling them anywhere.
 */
const DITHER =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n' color-interpolation-filters='sRGB'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='2.4' intercept='-0.7'/%3E%3CfeFuncG type='linear' slope='2.4' intercept='-0.7'/%3E%3CfeFuncB type='linear' slope='2.4' intercept='-0.7'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")";

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
 * Fades the field out before it reaches the headline. This replaces what
 * used to be a scrim layer painted on top: a mask costs nothing extra,
 * where a scrim was another full-height translucent layer over the base,
 * quantizing the ramp a second time.
 */
const FIELD_MASK = `linear-gradient(to bottom, transparent 0%, ${smoothRamp(
  34,
  70,
  (t) => `rgba(0,0,0,${t})`
)}, #000 100%)`;

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
        The field. One wrapper so the scroll settle has a single element to
        move: scrubbing each body individually would fight their keyframes
        for the `transform` property, and the last writer would win.

        The mask replaces what used to be a scrim layer painted on top.
        Fading the field out as it approaches the headline costs nothing
        extra, where a scrim was another full-height translucent layer over
        the base, quantizing the ramp a second time.

        Deliberately no `mix-blend-mode` on the bodies. Blending keeps a
        colour more saturated over the ink, but it also forces the whole
        stacking context to rasterize together, which would take five
        continuously animating layers off the compositor's fast path.
      */}
      <div
        data-field
        className="absolute inset-0"
        style={{
          maskImage: FIELD_MASK,
          // Safari carried the prefixed property for a long time and still
          // honours it. One extra declaration is cheaper than the failure
          // mode, which is the mask being ignored entirely and the field
          // washing straight over the headline.
          WebkitMaskImage: FIELD_MASK,
        }}
      >
        {BODIES.map((body) => (
          <div
            key={body.drift}
            data-drift={body.drift}
            // Every body spans the whole field and is placed by its
            // gradient's own `at` position rather than by box insets. That
            // keeps one coordinate space for the composition, and means
            // `scale` in the keyframes swings a body away from the hero's
            // centre, which is a more interesting path than scaling a
            // small box in place.
            className="absolute inset-0"
            style={{
              background: body.gradient,
              // `translate` rather than `transform`: the keyframes own
              // `transform`, and CSS applies the two independently.
              translate: `calc(var(--pointer-x, 0) * ${body.parallax[0]}rem) calc(var(--pointer-y, 0) * ${body.parallax[1]}rem)`,
            }}
          />
        ))}
      </div>

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
        ink by roughly `opacity x noise-mean`, a handful of levels. That is
        invisible here, since `--foreground` is a dark slate rather than
        true black, and it is a fair trade for bands that do not move.
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
          className="absolute -inset-[260px] opacity-[0.075]"
          style={{ backgroundImage: DITHER, backgroundSize: "200px 200px" }}
        />
      </div>
    </div>
  );
}
