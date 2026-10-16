import type { Metadata } from "next";

import { BRAND } from "@/lib/landing-content";
import { CONTENT_WIDTHS } from "@/components/system/widths";
import { SiteNav } from "@/components/marketing/site-nav";
import { Hero } from "@/components/marketing/hero/hero";
import { Why } from "@/components/marketing/why/why";
import { Efficiency } from "@/components/marketing/efficiency/efficiency";

export const metadata: Metadata = {
  title: `${BRAND} - Sell WiFi Vouchers Online`,
  description:
    "Connect your router, set your prices, and let customers pay online and get their hotspot login instantly. Built for hotspot businesses.",
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
        className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${CONTENT_WIDTHS.default}`}
      >
        <Why />
        <Efficiency />
        {/* Sections 4 to 10 land here, in order. */}
      </div>
    </>
  );
}
