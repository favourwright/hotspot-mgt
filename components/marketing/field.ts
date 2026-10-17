/**
 * The shared vocabulary for the landing page's gradient fields.
 *
 * The gaussian `softBody` helper that used to live here is gone with
 * the approach it served: hand-built falloff curves banded no matter
 * how carefully they were shaped, and `gradient-field.tsx` blurs a
 * field of small circles instead. What is left is the palette and the
 * dither, both of which are still shared.
 */

/**
 * The field's colours, from the palette in `landing.css`.
 *
 * These intentionally do not read `--primary`. That token is tuned to
 * carry text and sit behind controls, which caps how far its chroma can
 * go; used as a light source on a dark ground it reads muddy. The field
 * gets the same hue opened up, plus a warm and a cool neighbour so
 * overlapping bodies shift hue instead of stacking one colour on itself.
 */
export const PRIMARY = "var(--field-core)";
export const WARM = "var(--field-warm)";
export const LIGHT = "var(--field-light)";
export const GROUND = "var(--field-ground)";

/**
 * The pale counterpart to `GROUND`, for a field that has to read as a
 * light object rather than as a lit one.
 *
 * It exists because the accent band at the foot of the page needs the
 * same kind of abstract shape the media cards use, and a plum-grounded
 * field on crimson is two dark things on a bright one. See the `tone`
 * prop in `gradient-field.tsx` for why the blend mode has to change
 * with it.
 */
export const PALE = "oklch(0.975 0.008 350)";

export const lighter = (percent: number) =>
  `color-mix(in oklch, var(--field-core), white ${percent}%)`;

export const deeper = (percent: number) =>
  `color-mix(in oklch, var(--field-core), var(--field-ground) ${percent}%)`;

/**
 * Tiling greyscale grain, shared by every gradient surface on the page.
 *
 * Banding is quantization, and the answer to quantization is dither.
 * This lived in the hero only, which is why the media cards banded the
 * moment their colours got punchier: a stronger gradient takes larger
 * steps between 8-bit values, and nothing was breaking up the contours.
 *
 * `color-interpolation-filters='sRGB'` because Chrome defaults SVG
 * filters to linearRGB, which compresses the noise around mid-grey and
 * throws away most of its amplitude. The `feColorMatrix` pins alpha to
 * 1 so the layer is a flat sheet of grain rather than one with holes in
 * it, and the `feComponentTransfer` expands `fractalNoise`, which is
 * smooth and low-contrast by design. Both transfer stops are centred so
 * an input of 0.5 maps to 0.5 - that is what makes it a dither rather
 * than a veil.
 */
export const DITHER =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n' color-interpolation-filters='sRGB'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='2.4' intercept='-0.7'/%3E%3CfeFuncG type='linear' slope='2.4' intercept='-0.7'/%3E%3CfeFuncB type='linear' slope='2.4' intercept='-0.7'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")";
