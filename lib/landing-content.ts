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
    muted: "See what each venue earns,",
    strong: "counted from your own routers",
  },
  /**
   * Two-tone, like the reference: the claim in full ink, the consequence
   * dropping to muted. One sentence, broken where the emphasis changes.
   */
  statement: {
    lead: "Every sale lands as a record you can act on,",
    rest: "so you can see which venue is actually earning and which plan people keep coming back to.",
  },
  /**
   * The three cards describe ONE business, not three unrelated mockups.
   *
   * That consistency is the whole point of the numbers. An average of
   * ~1,700 vouchers a month is about 390 a week, and 390 vouchers at a
   * ~500 naira day pass is the 196,500 the payouts card collects. The
   * fee and the share sum to exactly that. Someone who reads all three
   * cards should find a business that could exist; someone who checks
   * the arithmetic should find it holds.
   *
   * If any of these change, change them together.
   */
  chart: {
    title: "Voucher sales",
    series: "Vouchers sold",
    period: "Last 9 months",
    /** Axis top. A round number above the peak, never the peak itself. */
    axisMax: 2400,
    ticks: [0, 800, 1600, 2400],
    average: 1700,
    points: [
      { label: "Jan", value: 1240 },
      { label: "Feb", value: 1680 },
      { label: "Mar", value: 1520 },
      { label: "Apr", value: 2380 },
      { label: "May", value: 1460 },
      { label: "Jun", value: 1330 },
      { label: "Jul", value: 1910 },
      { label: "Aug", value: 2080 },
      { label: "Sep", value: 1720 },
    ],
  },
  panels: {
    live: {
      title: "Who is online",
      caption: "Right now",
      totalLabel: "Online now",
      /** The venue counts, summed. Keep these in step. */
      total: 311,
      /**
       * Active devices only. An earlier version showed "38 / 60" against
       * a venue capacity, which the product does not model - plans cap
       * devices per voucher, not people per venue - so the denominator
       * was inventing a feature. The bars are proportional to the
       * busiest venue instead, which the data actually supports.
       */
      rows: [
        { name: "Hostel block A", active: 184 },
        { name: "Plaza, ground floor", active: 96 },
        { name: "Cafe", active: 31 },
      ],
      footnote: "Peak today 408, just after 7pm",
    },
    payouts: {
      title: "Payouts",
      caption: "This week",
      total: "\u20A6196,500",
      totalLabel: "Collected",
      /**
       * Part-to-whole, so it is drawn as one split bar rather than as a
       * second column chart - the sales card already owns that form, and
       * two charts of the same shape in one track read as one idea
       * repeated. Percentages are the real ones: 186,675 and 9,825 are
       * 95% and 5% of 196,500.
       */
      split: [
        { label: "Your share", value: "\u20A6186,675", percent: 95 },
        { label: "Platform fee", value: "\u20A69,825", percent: 5 },
      ],
      note: "Split the moment each payment clears, straight to your own account. We never hold it.",
    },
  },
} as const;

/**
 * Section 4: the figures.
 *
 * The reference fills this with business metrics - "30 million
 * candidates analyzed", "12k+ teams". We do not have numbers like that,
 * and a marketing page is the worst place to invent them: they are
 * checkable claims, and the walk-back is public.
 *
 * So the figures here are facts about how the product works rather than
 * claims about how many people use it. Every one is true by construction
 * and stays true on the day the product launches with one customer:
 * there is nothing physical to print, it sells while the owner is
 * asleep, and delivery happens on payment rather than on a human being
 * available.
 *
 * When there are real usage numbers worth showing, they replace these in
 * this file and nothing else changes. Keep the same test: a figure here
 * has to be something we would be comfortable being asked to evidence.
 */
export const IMPACT = {
  index: "03",
  eyebrow: "What changes",
  heading: "Selling, made automatic",
  support:
    "The parts of running a hotspot that used to need you standing behind a counter are the parts that now happen on their own.",
  figures: [
    {
      value: "Same second",
      caption: "Access reaches the customer the moment their payment clears.",
    },
    {
      value: "0",
      caption: "Cards to print, cut or hand over. Nothing physical to run out of.",
    },
    {
      value: "24/7",
      caption: "Your shop keeps selling on the nights and days you are not there.",
    },
  ],
} as const;

/**
 * Section 5: pricing.
 *
 * Only the framing lives here. The plans themselves are read live from
 * Firestore - the same billing plans a tenant picks from during
 * onboarding - so the price on this page cannot drift from the price
 * they are actually charged. That is the whole reason not to hard-code
 * them: a marketing page quoting a stale price is a promise somebody
 * has to honour.
 */
export const PRICING = {
  index: "04",
  eyebrow: "Pricing",
  heading: ["Plans built around", "how much you sell"],
  support:
    "Start on the smallest plan and move up when your venues do. Every plan includes the router connection, the portal and automatic payouts.",
  /** Shown when a plan has no price to charge, so it cannot be self-serve. */
  contactLabel: "Talk to us",
  ctaLabel: "Start selling",
  ctaHref: "/onboarding",
  includedLabel: "What's included",
} as const;
