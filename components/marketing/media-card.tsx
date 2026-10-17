import { cn } from "@/lib/utils";
import { lighter, PRIMARY, softBody } from "@/components/marketing/field";

/**
 * ---------------------------------------------------------------------
 * PLACEHOLDER IMAGERY. The reference fills these with abstract
 * photography. We have no asset library, so this composes the same
 * gradient field the hero uses, seeded per card so no two are identical.
 * This is the swap point when real imagery or product screenshots exist:
 * nothing outside this file knows what a media card contains.
 * ---------------------------------------------------------------------
 *
 * Deliberately static. The hero's field drifts because it is the page's
 * one focal object; four of these breathing away behind a tab row would be
 * four more continuously compositing layers competing with the text next
 * to them for attention.
 *
 * `seed` picks an arrangement rather than generating one randomly. A
 * random field would differ between the server render and the client,
 * which is a hydration mismatch, and would also change on every reload for
 * no reason.
 */

type Arrangement = Array<{
  color: string;
  size: string;
  at: string;
  peak: number;
}>;

/**
 * The card's own ground, deep rather than pale.
 *
 * On the white sheet these cards are the one place colour is allowed to
 * carry a whole surface, and a soft gradient over a near-white base just
 * reads as a smudge. Against ink the same bodies read as light, which is
 * the same trick the hero's backdrop relies on and the reason its
 * imagery has any presence at all.
 */
const CARD_GROUND =
  "color-mix(in oklch, var(--foreground), var(--primary) 16%)";

const ARRANGEMENTS: Arrangement[] = [
  [
    { color: PRIMARY, size: "62% 58%", at: "32% 74%", peak: 1 },
    { color: lighter(34), size: "40% 38%", at: "68% 36%", peak: 0.85 },
    { color: lighter(8), size: "48% 52%", at: "84% 86%", peak: 0.6 },
  ],
  [
    { color: lighter(16), size: "54% 60%", at: "70% 30%", peak: 0.95 },
    { color: PRIMARY, size: "58% 50%", at: "24% 68%", peak: 1 },
    { color: lighter(48), size: "26% 28%", at: "54% 52%", peak: 0.7 },
  ],
  [
    { color: PRIMARY, size: "66% 62%", at: "50% 84%", peak: 1 },
    { color: lighter(28), size: "36% 40%", at: "26% 28%", peak: 0.8 },
    { color: lighter(4), size: "44% 46%", at: "82% 54%", peak: 0.75 },
  ],
  [
    { color: PRIMARY, size: "56% 64%", at: "74% 72%", peak: 1 },
    { color: lighter(40), size: "32% 34%", at: "34% 40%", peak: 0.75 },
    { color: lighter(2), size: "50% 44%", at: "16% 88%", peak: 0.7 },
  ],
];

export function MediaCard({
  seed,
  className,
  staticWidth,
}: {
  seed: number;
  className?: string;
  /**
   * Pins the gradient's geometry to a fixed width instead of letting it
   * fill the element.
   *
   * Without this, every body is sized in percentages of its container,
   * so an element that changes width restretches the whole composition -
   * which reads as the image being resized rather than uncovered. With
   * it the composition stays put and a parent that grows simply shows
   * more of it, which is what a reveal should feel like. Set it wider
   * than the element ever gets, so there is always more image to show.
   */
  staticWidth?: string;
}) {
  const bodies = ARRANGEMENTS[seed % ARRANGEMENTS.length];

  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden rounded-surface", className)}
      style={{ background: CARD_GROUND }}
    >
      {bodies.map((body, index) => (
        <div
          key={index}
          className={staticWidth ? "absolute inset-y-0 left-0" : "absolute inset-0"}
          style={{
            width: staticWidth,
            background: softBody(body.color, body.size, body.at, body.peak),
          }}
        />
      ))}
    </div>
  );
}
