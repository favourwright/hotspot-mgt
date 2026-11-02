import type { Metadata } from "next";

import logoPng from "@/public/logo.png";

import { BRAND, FOOTER } from "@/lib/landing-content";
import { indexable, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/system/json-ld";
import { CONTENT_WIDTHS } from "@/components/system/widths";
import { SiteNav } from "@/components/marketing/site-nav";
import { Hero } from "@/components/marketing/hero/hero";
import { Why } from "@/components/marketing/why/why";
import { Efficiency } from "@/components/marketing/efficiency/efficiency";
import { Impact } from "@/components/marketing/impact/impact";
import { Pricing } from "@/components/marketing/pricing/pricing";
import { How } from "@/components/marketing/how/how";
import { Solutions } from "@/components/marketing/solutions/solutions";
import { Stories } from "@/components/marketing/stories/stories";
import { Faq } from "@/components/marketing/faq/faq";
import { Cta } from "@/components/marketing/cta/cta";

/**
 * Rendered at request time, for the pricing section's sake.
 *
 * It reads live billing plans from Firestore, and CI runs `npm run build`
 * with no Firebase credentials - so anything prerendered at build time
 * that touches Firestore fails the build. The list is cached in process
 * for five minutes, so this costs one read per plan per five minutes per
 * instance rather than one per visitor.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${BRAND} - Sell WiFi Vouchers Online`,
  description:
    "Connect your router, set your prices, and let customers pay online and get their hotspot login instantly. Built for hotspot businesses.",
  ...indexable("/"),
};

/**
 * The landing page, served at `/` on the apex domain.
 *
 * Sections are composed here in document order and nowhere else, so the
 * shape of the page is readable in one screen. Each owns its own markup,
 * copy and motion.
 */
export default function LandingPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: BRAND,
              url: SITE_URL,
              logo: `${SITE_URL}${logoPng.src}`,
              email: FOOTER.contact.email,
            },
            { "@type": "WebSite", name: BRAND, url: SITE_URL },
          ],
        }}
      />
      <SiteNav />
      <Hero />

      {/*
        One measure for every section below the hero, and no surface of
        its own. The sections sit directly on the page's white; anything
        that needs to separate from it brings its own tint, which is what
        the cards in section 3 do. An earlier version wrapped all of this
        in a white sheet against a tinted page, which is the same contrast
        read the other way round and put section 2 inside a card it was
        never meant to be in.
      */}
      <div
        className={`mx-auto w-full px-3 sm:px-6 ${CONTENT_WIDTHS.default}`}
      >
        <Why />
      </div>

      {/* Outside the measured column, like section 8 below: the pinned
          track runs to the viewport edges, and it brings its own measure
          for the header and for the stacked layout phones get. */}
      <Efficiency />

      <div
        className={`mx-auto w-full px-3 sm:px-6 ${CONTENT_WIDTHS.default}`}
      >
        <Impact />
        <Pricing />
        {/* One tinted band for both. See `how.tsx` for why they share
            it rather than taking one each. */}
        <div className="rounded-surface bg-sunken px-6 sm:px-10 lg:px-14">
          <How />
          <Solutions />
        </div>
      </div>

      {/* Outside the measured column: section 8's track runs to the
          viewport edges. */}
      <Stories />

      <div
        className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${CONTENT_WIDTHS.default}`}
      >
        <Faq />
      </div>

      {/* Outside the measured column too: the closing band takes the
          hero's inset so the page is framed the same at both ends. */}
      <Cta />
    </>
  );
}
