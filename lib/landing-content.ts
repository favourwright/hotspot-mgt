/**
 * Every string on the landing page.
 *
 * One file rather than copy inlined in each section, because marketing copy
 * is the part of this page most likely to be rewritten by someone who does
 * not want to read JSX to do it. Sections import what they need and own no
 * text of their own.
 *
 * The audience is a hotspot business owner: the person who signs up,
 * connects a MikroTik and sells access. Buyers never see this page, they
 * arrive at their venue's own subdomain, so nothing here addresses them.
 */

export const BRAND = "OgaWiFi";

/**
 * Navigation. Deliberately short.
 *
 * Only links that resolve today are listed. In-page anchors get added as
 * the sections they point at land, rather than being written ahead and
 * silently doing nothing in the meantime.
 */
export const NAV_LINKS: { label: string; href: string }[] = [
  { label: "FAQ", href: "/faq" },
];

export const NAV_ACTIONS = {
  signIn: { label: "Sign in", href: "/auth" },
  start: { label: "Start selling", href: "/onboarding" },
} as const;

export const HERO = {
  /**
   * Scratch cards are the thing this product actually replaces for most of
   * the market, so the headline names them rather than describing the
   * software in the abstract.
   */
  headline: "Sell WiFi, Not Scratch Cards",
  markers: ["Instant vouchers", "Online payments", "Router control"],
  support:
    "Connect your MikroTik once. Customers pay online, get their login the same second, and your router does the rest.",
  actions: {
    primary: { label: "Start selling", href: "/onboarding" },
    secondary: { label: "See how it works", href: "/faq" },
  },
  footer: {
    eyebrow: "Hotspot automation",
    capabilities: ["Instant delivery", "Automatic expiry", "Split payouts"],
    /**
     * Integrations, set as plain wordmarks rather than logos. These are
     * things the product genuinely talks to; rendering them as logos in a
     * row under the hero would read as a customer list and imply an
     * endorsement none of them have given.
     */
    worksWithLabel: "Works with",
    worksWith: ["MikroTik", "RouterOS", "WireGuard", "Paystack"],
  },
} as const;
