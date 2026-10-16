/**
 * The shared vocabulary for the landing page's gradient fields: the hero's
 * backdrop and the media cards in the sections below.
 *
 * One copy rather than two, because the falloff curve below is the part
 * that took the longest to get right and is the easiest to get subtly
 * wrong a second time.
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
export const BODY_FALLOFF = (() => {
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
export function softBody(color: string, size: string, at: string, peak: number) {
  const ramp = BODY_FALLOFF.map(
    ([position, alpha]) =>
      `color-mix(in oklch, ${color}, transparent ${((1 - alpha * peak) * 100).toFixed(2)}%) ${position.toFixed(1)}%`
  ).join(", ");

  return `radial-gradient(${size} at ${at}, ${ramp})`;
}

export const PRIMARY = "var(--primary)";

export const lighter = (percent: number) =>
  `color-mix(in oklch, var(--primary), white ${percent}%)`;

export const deeper = (percent: number) =>
  `color-mix(in oklch, var(--primary), var(--foreground) ${percent}%)`;
