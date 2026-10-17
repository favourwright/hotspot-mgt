import { STORIES } from "@/lib/landing-content";
import { StoriesMarquee } from "@/components/marketing/stories/stories-marquee";
import { StoriesMotion } from "@/components/marketing/stories/stories-motion";

/**
 * Section 8.
 *
 * Centred header, then a track that runs past the container's edges.
 * The bleed is the point: a row of quotes that stops neatly inside the
 * measure looks like a finite list, where one running off both sides
 * says there are more of them.
 */
export function Stories() {
  return (
    <StoriesMotion className="overflow-hidden py-20 sm:py-28">
      <div className="mx-auto max-w-[44rem] px-4 text-center sm:px-6 lg:px-8">
        <p
          data-reveal="eyebrow"
          className="flex items-baseline justify-center gap-3 text-xs font-medium tracking-[0.12em] uppercase"
        >
          <span className="text-primary">({STORIES.index})</span>
          {STORIES.eyebrow}
        </p>

        <h2
          data-reveal="heading"
          className="mt-8 text-[clamp(2rem,3.6vw,3.25rem)] leading-[1.04] font-medium tracking-[-0.03em] text-balance"
        >
          {STORIES.heading}
        </h2>

        <p
          data-reveal="support"
          className="mt-6 text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
        >
          {STORIES.support}
        </p>
      </div>

      {/* Outside the measured column on purpose, so the track can run to
          the viewport edges. */}
      <div data-reveal="track" className="mt-14">
        <StoriesMarquee />
      </div>
    </StoriesMotion>
  );
}
