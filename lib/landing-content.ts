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
    "Connect your router once. Customers pay online, get their login the same second, and your network does the rest.",
  actions: {
    primary: { label: "Start selling", href: "/onboarding" },
    secondary: { label: "See how it works", href: "/faq" },
  },
  footer: {
    eyebrow: "Hotspot automation",
    capabilities: ["Instant delivery", "Automatic expiry", "Automatic payouts"],
    /**
     * Integrations, set as plain wordmarks rather than logos. These are
     * things the product genuinely talks to; rendering them as logos in a
     * row under the hero would read as a customer list and imply an
     * endorsement none of them have given.
     *
     * MikroTik is the only router vendor supported today, but it is named
     * here and nowhere else on purpose. A compatibility row reads as a
     * list that will grow; putting the vendor in the headline or the
     * support copy would frame the whole product as MikroTik-only, which
     * is a claim we would then have to walk back. Everything above this
     * says "your router". Keep it that way. RouterOS came out of this list
     * for the same reason: it is MikroTik's own OS, so naming both doubled
     * the vendor's weight in a three-item row for no extra information.
     */
    worksWithLabel: "Works with",
    worksWith: ["MikroTik", "WireGuard", "Payment gateway"],
  },
} as const;

/**
 * Section 2: why this instead of doing it by hand.
 *
 * The tab row is the section's whole structure, so the copy per tab has to
 * carry the same weight: one claim, one sentence of substance, no filler.
 * Each tab is a real area of the product rather than a marketing grouping,
 * which keeps this honest and makes it obvious where a new tab would go.
 */
export const WHY = {
  index: "01",
  eyebrow: "Why OgaWiFi",
  heading: ["More than vouchers,", "we run the whole sale"],
  support:
    "Payment, delivery, expiry and payout happen in one pass. Selling access stops being something you do by hand at the counter.",
  link: { label: "See how it works", href: "/faq" },
  tabs: [
    {
      key: "delivery",
      label: "Voucher delivery",
      copy: "A customer pays and their login exists on the router the same second. No codes to print, no cards to cut, nobody waiting on you to be in the shop.",
    },
    {
      key: "payments",
      label: "Payments",
      copy: "Every sale is split at the moment it clears, so your share reaches your own account without you reconciling anything at the end of the week.",
    },
    {
      key: "router",
      label: "Router control",
      copy: "Your router stays reachable over an encrypted tunnel, so plans, profiles and live sessions are all managed from here rather than from a laptop on site.",
    },
    {
      key: "reporting",
      label: "Reporting",
      copy: "Sales, active users and expiring access in one view, counted per location, so you can see which venue is actually earning.",
    },
  ],
} as const;

/**
 * Section 3: the same claim, shown rather than stated.
 *
 * The chart is an illustration of the owner's dashboard, not a data
 * display: there is no real data on a marketing page. It is built to the
 * same rules a real chart would follow, because a plausible chart is the
 * only kind worth showing, but it is `aria-hidden` and carries no
 * interactivity - a tooltip on invented numbers would be a lie with a
 * hover state. The surrounding copy carries the meaning for anyone who
 * cannot see it.
 */
export const EFFICIENCY = {
  index: "02",
  eyebrow: "In practice",
  aside: {
    muted: "Know what each venue earns with",
    strong: "numbers from your own routers",
  },
  /**
   * Two-tone, like the reference: the claim in full ink, the consequence
   * dropping to muted. One sentence, broken where the emphasis changes.
   */
  statement: {
    lead: "Every sale lands as a record you can act on,",
    rest: "so you can see which location is actually earning and which plan people keep coming back for.",
  },
  chart: {
    title: "Voucher sales",
    series: "Vouchers sold",
    period: "Last 9 months",
    /** Axis top. A round number above the peak, never the peak itself. */
    axisMax: 240,
    ticks: [0, 80, 160, 240],
    average: 155,
    points: [
      { label: "Jan", value: 120 },
      { label: "Feb", value: 186 },
      { label: "Mar", value: 142 },
      { label: "Apr", value: 212 },
      { label: "May", value: 128 },
      { label: "Jun", value: 118 },
      { label: "Jul", value: 164 },
      { label: "Aug", value: 176 },
      { label: "Sep", value: 152 },
    ],
  },
/**
 * The panels that travel through the pinned track, in order. Each is an
 * illustration of a real screen in the owner's area, and each is
 * `aria-hidden` for the same reason the chart is: the numbers are
 * invented, so the copy beside them carries the meaning.
 */
panels: {
  live: {
    title: "Who is online",
    caption: "Right now",
    rows: [
      { name: "Main hall", active: 38, capacity: 60 },
      { name: "Annex", active: 21, capacity: 40 },
      { name: "Rooftop bar", active: 9, capacity: 25 },
    ],
  },
  payouts: {
    title: "Payouts",
    caption: "This week",
    total: "N184,500",
    totalLabel: "Collected",
    rows: [
      { label: "Your share", value: "N175,275" },
      { label: "Platform fee", value: "N9,225" },
    ],
    note: "Split at the moment each payment clears.",
  },
},
} as const;
