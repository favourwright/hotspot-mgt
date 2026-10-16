// Lenis's own required rules (it sets `html.lenis` and needs the matching
// height/scroll-behavior declarations). Imported here rather than in
// globals.css so nothing outside this route group pays for it.
import "lenis/dist/lenis.css";
import "./landing.css";

import { SmoothScroll } from "@/components/marketing/smooth-scroll";

/**
 * The marketing shell.
 *
 * A route group, so the URL is still `/`. Its whole job is to scope the two
 * global side effects this page has - smooth scrolling and the animation
 * start states - to this route and no other. The admin area, the auth
 * pages, the onboarding wizard and every tenant portal nest under the same
 * root layout and are untouched by both: they keep native scrolling and
 * ship neither GSAP nor Lenis.
 *
 * Deliberately not `AppShell`. That component caps and gutters a content
 * column, which is right for every page in the product and wrong for a
 * landing page whose sections each decide their own measure and several of
 * which run edge to edge.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SmoothScroll>
      {/*
        White is the ground on the landing page, and the canvas tint is
        what a surface uses when it needs to separate FROM the ground -
        the hero's container, the cards in section 3. That is the app's
        tint-to-white cycle inverted, and deliberately so: the product's
        screens are dense and want a tint to rest on, where a marketing
        page is mostly open space and reads better when the open space is
        the brightest thing on it.
      */}
      <div data-landing className="min-h-dvh bg-raised">
        {/*
          Entrance animations start from `opacity: 0` or a collapsed
          transform, which with no JavaScript to finish them would leave
          the page blank. This is the one mechanism that distinguishes
          "scripting off" from "scripting on but not run yet": a class
          toggled at hydration cannot, because the browser paints the
          server HTML before hydration and the content would visibly
          appear and then be hidden again.

          Every start-state attribute has to be listed here. `[data-bar]`
          was missed when the sales chart was added, which left the chart
          rendered as an empty plot for anyone with scripting off - the
          axis and the labels were there and all nine columns were
          scaled to zero height.

          Set through `dangerouslySetInnerHTML` because React renders
          `<noscript>` children as real elements, which hydration then
          complains about.
        */}
        <noscript
          dangerouslySetInnerHTML={{
            __html:
              "<style>[data-landing] [data-reveal],[data-landing] [data-bar],[data-landing] [data-rule]{opacity:1;transform:none}</style>",
          }}
        />
        {children}
      </div>
    </SmoothScroll>
  );
}
