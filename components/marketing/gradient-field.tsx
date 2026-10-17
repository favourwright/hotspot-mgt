import { cn } from "@/lib/utils";
import { GROUND, LIGHT, PRIMARY, WARM } from "@/components/marketing/field";

/**
 * A field of soft circles under a heavy blur.
 *
 * This replaces an earlier approach built from five large gaussian
 * gradients, which banded persistently and could not be made to stop.
 * The reason this one does not is worth stating, because it is the
 * whole point of the change: **blur happens after rasterization**. A
 * gradient is quantized to 8 bits and then blurred, and the blur
 * averages neighbouring pixels, so the quantization steps are gone
 * rather than merely disguised. Dithering on top can only mask a
 * contour; this removes it. Many small circles at random sizes and
 * phases also break up contours in a way a few large smooth bodies
 * cannot, because there is no long shallow ramp left to band.
 *
 * ## Rendered small, scaled up
 *
 * The stage is a quarter scale and blurred by a quarter as much, then
 * scaled back up by four. Visually that is the same as the full-size
 * blur, but the filter runs over a sixteenth of the pixels - and a
 * filter is the expensive thing here, re-rasterizing whenever anything
 * inside it changes, which with circles fading in and out is every
 * frame.
 *
 * The upscale is not just a saving. Scaling by four interpolates
 * between samples, which adds roughly two bits of effective precision
 * on its own, so the thing that makes it cheap is also the second
 * reason it does not band.
 *
 * The stage is oversized and offset so the blur's soft edge falls
 * outside the container rather than showing as a vignette on it.
 *
 * ## Deterministic, not random
 *
 * The reference implementation calls `Math.random()` and re-randomises
 * each circle when its animation ends. Both are wrong here: random
 * values differ between the server render and the client, which is a
 * hydration mismatch, and rebuilding DOM nodes on every cycle churns
 * fifty elements and fifty listeners forever. A seeded generator gives
 * the same arrangement on both sides and lets CSS loop the animation
 * with no JavaScript running at all.
 */

/** Small deterministic PRNG, so a seed always yields the same field. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = [PRIMARY, PRIMARY, PRIMARY, WARM, WARM, LIGHT];

export function GradientField({
  seed = 1,
  count = 18,
  animated = true,
  className,
  staticWidth,
  blur = 9,
  /** Vertical band the circles are placed in, as percentages. */
  from = 20,
  to = 105,
}: {
  seed?: number;
  count?: number;
  animated?: boolean;
  className?: string;
  from?: number;
  to?: number;
  /**
   * Pins the field to a fixed width instead of filling its parent.
   *
   * For the places where a container grows to reveal the image: with a
   * fixed width the composition stays put and the parent uncovers more
   * of it, where filling would restretch everything as the parent
   * resizes. Set it wider than the parent ever gets.
   */
  staticWidth?: string;
  /**
   * Blur radius on the quarter-scale stage, so the effective radius is
   * four times this. It has to be set per surface rather than fixed:
   * the same radius that merges a field across a 1300px hero is a huge
   * fraction of a 280px card and averages it to mush.
   */
  blur?: number;
}) {
  const random = mulberry32(seed);

  const circles = Array.from({ length: count }, () => {
    const duration = 7 + random() * 11;
    return {
      size: 16 + random() * 40,
      x: random() * 100,
      y: from + random() * (to - from),
      color: PALETTE[Math.floor(random() * PALETTE.length)],
      duration,
      // A negative delay starts each circle part-way through its own
      // cycle, so the field is already mixed on the first frame instead
      // of every circle fading up together.
      delay: -random() * duration,
    };
  });

  return (
    <div
      aria-hidden
      className={cn(
        "absolute overflow-hidden",
        staticWidth ? "inset-y-0 left-0" : "inset-0",
        className
      )}
      style={{ width: staticWidth }}
    >
      <div className="absolute inset-0" style={{ background: GROUND }} />

      <div
        className="absolute h-[30%] w-[30%] origin-top-left scale-[4]"
        style={{ left: "-5%", top: "-5%", filter: `blur(${blur}px)` }}
      >
        {circles.map((circle, index) => (
          <span
            key={index}
            data-circle={animated ? "" : undefined}
            // `screen` so overlaps add instead of averaging - the
            // difference between light and paint, and the reason a
            // blurred field of circles can still look saturated. The
            // blurred stage is already a stacking context, so the
            // blending is confined to it for free.
            className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen"
            style={{
              left: `${circle.x}%`,
              top: `${circle.y}%`,
              width: `${circle.size}%`,
              // Fades to its OWN hue at zero alpha, not the `transparent`
              // keyword. Blur averages whatever it is given, so edges
              // that trail off toward transparent black drag the whole
              // field's saturation down with them.
              background: `radial-gradient(closest-side, ${circle.color}, color-mix(in oklch, ${circle.color}, transparent 100%))`,
              animationDuration: `${circle.duration.toFixed(2)}s`,
              animationDelay: `${circle.delay.toFixed(2)}s`,
              // Static fields still want the circles visible.
              opacity: animated ? undefined : 0.95,
            }}
          />
        ))}
      </div>
    </div>
  );
}
