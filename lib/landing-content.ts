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

/**
 * Section 6: how it actually works.
 *
 * Three steps rather than three feature names. The reference lists
 * capabilities under this heading, but "how it works" is a promise to
 * explain a sequence, and an owner deciding whether to sign up wants to
 * know what they personally have to do.
 *
 * The mock beside them is the CUSTOMER's view, not another dashboard.
 * Section 3 already shows three owner screens; repeating that form here
 * would say nothing new, where the buyer's side is the half of the
 * product an owner never sees and is the thing these steps lead to.
 *
 * The 500 naira day pass is the same figure section 3's arithmetic
 * implies. If one moves, move both.
 */
export const HOW = {
  index: "05",
  eyebrow: "How it works",
  heading: ["Three steps to", "selling your first voucher"],
  support:
    "No static IP, no port forwarding, no scratch cards to print. Setup is one guided pass and the rest runs on its own.",
  steps: [
    {
      key: "connect",
      title: "Connect your router",
      copy: "One guided setup opens an encrypted tunnel to your router and installs the sign-in page on it.",
    },
    {
      key: "price",
      title: "Set your plans",
      copy: "Decide what a day, a week or a month costs, and how many devices each voucher covers.",
    },
    {
      key: "sell",
      title: "Share your link",
      copy: "Customers pay on your own page and are online the same second. You do not have to be there.",
    },
  ],
  mock: {
    venue: "Hostel block A",
    prompt: "Choose your plan",
    options: [
      { label: "Day pass", meta: "24 hours, 1 device", price: "₦500" },
      { label: "3 days", meta: "72 hours, 2 devices", price: "₦1,200" },
      { label: "One week", meta: "7 days, 2 devices", price: "₦2,500" },
    ],
    /** Index of the option shown as chosen. */
    selected: 0,
    action: "Pay ₦500",
    note: "Your login appears here the moment payment clears.",
  },
} as const;

/**
 * Section 7: who it is for.
 *
 * Three audiences rather than three product tiers. The pricing section
 * already answers "what does it cost"; this one answers "is it for
 * someone like me", which is a different question and the reason the
 * reference gives it its own band.
 */
export const SOLUTIONS = {
  index: "06",
  eyebrow: "Solutions",
  heading: "For every kind of venue.",
  support:
    "The same setup whether you run one cafe or twenty blocks of student housing.",
  link: { label: "See how it works", href: "/faq" },
  items: [
    {
      key: "single",
      title: "For one venue",
      copy: "One router, one sign-in page, and a price list you can change from your phone between customers.",
    },
    {
      key: "multi",
      title: "For several locations",
      copy: "Every venue keeps its own router, its own plans and its own numbers, all under one login.",
    },
    {
      key: "managed",
      title: "For sites you manage",
      copy: "Run access for venues you do not own, with each one's takings counted and settled separately.",
    },
  ],
} as const;

/**
 * Section 8: customer stories.
 *
 * Shaped to match what the planned review feature will return - a name,
 * what they run, a rating and the quote - so that swapping this array
 * for live data is a change to one import and nothing else, the way the
 * pricing section already reads live billing plans.
 *
 * Until then these are placeholder quotes. Replace them with real ones
 * before this goes near production: a testimonial is an attributed
 * statement, and the attribution is the part that has to be true.
 *
 * Avatars are generated from the name through `getAvatarUrl`, the same
 * DiceBear helper the product already uses for customer avatars, so
 * nobody's likeness is being invented either.
 */
export const STORIES = {
  index: "07",
  eyebrow: "Customer stories",
  heading: "Venues that stopped cutting cards.",
  support:
    "Owners who moved their hotspot online and got their evenings back, in their own words.",
  items: [
    {
      name: "Chidinma Okafor",
      role: "Hostel block, Akoka",
      rating: 5,
      quote:
        "I used to sit up on Sunday nights cutting cards for the week. Now the students pay on their phones at two in the morning and I find out when I check the dashboard.",
    },
    {
      name: "Tunde Adeyemi",
      role: "Cafe and co-working, Ikeja",
      rating: 5,
      quote:
        "Setup took one afternoon with the router I already had. The part I did not expect was never arguing about change again.",
    },
    {
      name: "Blessing Eze",
      role: "Shopping plaza, Enugu",
      rating: 5,
      quote:
        "Three floors, three routers, one login. I can see which floor is actually earning instead of guessing from how busy it looks.",
    },
    {
      name: "Samuel Attah",
      role: "Manages four sites, Abuja",
      rating: 5,
      quote:
        "Each site keeps its own takings and settles on its own, so I am not the one holding anybody's money. That alone was worth moving for.",
    },
  ],
} as const;

/**
 * Section 9: the FAQ.
 *
 * Questions are selected by id from `lib/faq-data.ts` rather than
 * written again here. The landing page and `/faq` answer the same
 * questions for the same people a few minutes apart, and a second copy
 * of the wording is a second thing to keep true.
 *
 * These five are the ones a prospective owner asks before signing up.
 * Everything else lives on the FAQ page, which the section links to.
 */
export const FAQ = {
  index: "08",
  eyebrow: "FAQs",
  heading: ["Questions worth", "asking first."],
  support:
    "The things owners ask before they connect a router. The rest are on the full FAQ.",
  link: { label: "Read the full FAQ", href: "/faq" },
  picks: [
    "become-a-business-owner-link",
    "onboarding-flow",
    "billing-plans-explained",
    "why-wireguard",
    "switch-plan",
  ],
} as const;

/**
 * Section 10: the closing band.
 *
 * The last thing on the page is the same ask the hero opens with, and
 * that repetition is deliberate - a visitor who has read nine sections
 * should not have to scroll back up to act. The wording differs from the
 * hero's on purpose, though: the hero sells the idea, this sells the
 * evening it takes to do it.
 */
export const CTA = {
  heading: ["Set it up today.", "Sell tonight."],
  support:
    "Connect a router, set your prices, and take your first payment before closing time.",
  action: { label: "Start selling", href: "/onboarding" },
} as const;

/**
 * The footer.
 *
 * Every link here resolves today. The reference fills two columns with
 * Blog, Careers and About us; we have four public routes, so there is one
 * column of them and the space the second would have taken goes to the
 * contact block instead. A footer column of links to pages that do not
 * exist is worse than a shorter footer.
 */
export const FOOTER = {
  blurb:
    "Voucher sales, payments and router control for hotspot businesses. One account, any number of locations.",
  links: {
    heading: "Product",
    items: [
      { label: "Start selling", href: "/onboarding" },
      { label: "Sign in", href: "/auth" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  contact: {
    heading: "Talk to a human",
    /**
     * This has to be a mailbox somebody reads. It is the only address on
     * the site, so a bounce here is a lost customer rather than a dead
     * link - check it exists before this page goes live.
     */
    email: "support@ogawifi.online",
    secondary: {
      heading: "Already selling",
      label: "Open your dashboard",
      href: "/auth",
    },
  },
} as const;

/**
 * The copyright line.
 *
 * A function rather than a constant: a module-level `new Date()` is
 * evaluated once when the process starts, so a server that stays up over
 * New Year would serve last year's notice until it was restarted.
 */
export function footerLegal(): string {
  return `(c) ${new Date().getFullYear()} ${BRAND}. All rights reserved.`;
}
