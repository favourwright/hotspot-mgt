import type { Metadata } from "next";

import { BRAND } from "@/lib/landing-content";
import { SiteNav } from "@/components/marketing/site-nav";
import { Hero } from "@/components/marketing/hero/hero";

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
      {/* Sections 2 to 11 land here, in order. */}
    </>
  );
}
