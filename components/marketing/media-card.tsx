import { cn } from "@/lib/utils";
import { GradientField } from "@/components/marketing/gradient-field";

/**
 * ---------------------------------------------------------------------
 * PLACEHOLDER IMAGERY. The reference fills these with abstract
 * photography. We have no asset library, so this composes the same
 * gradient field the hero uses, seeded per card so no two are alike.
 * This is the swap point when real imagery or product screenshots
 * exist: nothing outside this file knows what a media card contains.
 * ---------------------------------------------------------------------
 *
 * Static, unlike the hero's. The hero's field drifts because it is the
 * page's one focal object; several of these breathing away behind a tab
 * row would be more continuously filtering layers competing with the
 * text beside them for attention.
 *
 * It used to build its own composition out of large gaussian bodies,
 * which banded badly and could not be made to stop. `GradientField`
 * blurs a field of small circles instead, and blur removes quantization
 * steps rather than masking them - see that file for why that is the
 * difference.
 */
export function MediaCard({
  seed,
  className,
  staticWidth,
}: {
  seed: number;
  className?: string;
  /** Keeps the composition from restretching when the parent grows. */
  staticWidth?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden rounded-surface", className)}
    >
      {/* Offset so each card gets a different arrangement from the same
          deterministic generator. */}
      <GradientField
        seed={seed * 17 + 3}
        count={12}
        animated={false}
        from={10}
        to={98}
        // A quarter of the hero's, because this is a quarter of its
        // size: blur has to stay proportional or the field averages
        // itself flat.
        blur={6}
        staticWidth={staticWidth}
      />
    </div>
  );
}
