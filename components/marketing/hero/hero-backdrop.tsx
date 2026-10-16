/**
 * The hero's background.
 *
 * ---------------------------------------------------------------------
 * PLACEHOLDER. The reference puts an animated three.js scene here, which
 * we are not using. This file is the isolated slot for whatever replaces
 * it: nothing outside it knows or cares what the background is.
 * ---------------------------------------------------------------------
 *
 * The contract the replacement has to keep, so the rest of the hero does
 * not have to change with it:
 *
 * - Absolutely fills the hero and clips to its radius.
 * - `aria-hidden` and non-interactive. Every control in the hero sits
 *   above it, and a background that takes pointer events eats them.
 * - Reads `--pointer-x` / `--pointer-y` off the hero root for any
 *   pointer reactivity. Those are published once, damped, by
 *   `usePointerField`, so a layer in here never attaches its own listener
 *   and never runs its own animation loop.
 * - Leaves the top light enough for near-black text and the bottom dark
 *   enough for white, which is what the two text blocks over it assume.
 *
 * Deliberately a server component with no JavaScript at all: the parallax
 * below is two CSS `translate` declarations reading variables somebody else
 * maintains. Keeping it that way is worth something, so prefer a
 * replacement that stays declarative if the effect allows it.
 *
 * The layers stack bottom to top: surface, ink band, glow, top scrim. The
 * ink band sits UNDER the glow rather than over it, which is the whole
 * difference between this reading as a horizon and as a dirty gradient.
 * Darkening a coloured wash from above averages it toward grey; lighting a
 * dark band from below keeps the colour saturated.
 */
export function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-surface"
    >
      {/*
        Between the raised white and the canvas tint, rather than either.
        Pure white leaves the white nav pill invisible against it; the plain
        tint makes the container's top edge vanish into the page. One step
        in from each gives the nav something to sit on and the inset
        container a visible edge, without a border.
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "color-mix(in oklch, var(--surface-raised), var(--surface-canvas) 55%)",
        }}
      />

      {/* The ink band. Even across the full width, so the footer strip
          reads with the same contrast at both ends. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[44%]"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, color-mix(in oklch, var(--foreground), transparent 72%) 38%, color-mix(in oklch, var(--foreground), transparent 12%) 78%, var(--foreground) 100%)",
        }}
      />

      {/*
        The glow. Pure radial gradients rather than a blurred shape: a
        gradient is already smooth, so this needs no `filter`, and an
        unfiltered layer can be translated by the compositor without
        re-rasterising a blur on every frame.

        `screen` is what keeps it reading as light rather than as paint.
        Over the ink band it adds, so the colour stays saturated instead of
        being averaged toward grey; over the pale surface above it has
        almost no effect, which confines it to the band without a hard
        edge anywhere.
      */}
      <div
        className="absolute -inset-x-[12%] top-[48%] -bottom-[10%] mix-blend-screen"
        style={{
          background:
            "radial-gradient(46% 56% at 50% 80%, var(--primary) 0%, color-mix(in oklch, var(--primary), transparent 38%) 42%, transparent 74%)",
          translate:
            "calc(var(--pointer-x, 0) * 2.5rem) calc(var(--pointer-y, 0) * 1.25rem)",
        }}
      />

      {/* A second, smaller body moving against the first, so the field has
          some depth rather than sliding as one flat sheet. */}
      <div
        className="absolute -inset-x-[8%] top-[56%] -bottom-[6%] opacity-70 mix-blend-screen"
        style={{
          background:
            "radial-gradient(32% 42% at 32% 82%, color-mix(in oklch, var(--primary), white 35%) 0%, transparent 64%)",
          translate:
            "calc(var(--pointer-x, 0) * -1.75rem) calc(var(--pointer-y, 0) * -1rem)",
        }}
      />

      {/* Keeps the headline on flat surface no matter what the glow does
          underneath it. */}
      <div
        className="absolute inset-x-0 top-0 h-[62%]"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in oklch, var(--surface-raised), var(--surface-canvas) 55%) 0%, color-mix(in oklch, var(--surface-raised), var(--surface-canvas) 55%) 55%, transparent 100%)",
        }}
      />
    </div>
  );
}
