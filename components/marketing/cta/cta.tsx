import Link from "next/link";
import { ArrowRight, Wifi } from "lucide-react";

import { BRAND, CTA, FOOTER, footerLegal } from "@/lib/landing-content";
import { Button } from "@/components/system/button";
import { CONTENT_WIDTHS } from "@/components/system/widths";
import { MediaCard } from "@/components/marketing/media-card";
import { CtaMotion } from "@/components/marketing/cta/cta-motion";

/**
 * Section 10: the closing band, and the site footer inside it.
 *
 * One element rather than two, as in the reference. A separate footer
 * under a separate CTA band would put two full-width coloured surfaces
 * back to back with a seam between them; folding the footer into the band
 * makes the bottom of the page one object, and it is the only place on
 * the page that is accent-coloured, which is what makes it read as an
 * ending.
 *
 * It takes its horizontal inset from the hero's rather than from the
 * measured column the middle sections use, so the top and bottom of the
 * page are framed identically. Both numbers come from `CONTENT_WIDTHS`
 * and the same `px-2 sm:px-6`, which is the only reason they agree.
 */
export function Cta() {
  const { links, contact } = FOOTER;

  return (
    <CtaMotion
      className={`mx-auto w-full px-2 pt-20 pb-2 sm:px-6 sm:pt-28 sm:pb-6 ${CONTENT_WIDTHS.default}`}
    >
      <div className="relative overflow-hidden rounded-surface bg-primary text-primary-foreground">
        {/* The container for the wordmark's sizing as well as the padding
            for everything else: the mark is measured in `cqw`, and it has
            to fill the padded width rather than the panel's. */}
        <div className="@container px-5 pt-12 pb-4 sm:px-8 sm:pt-16 sm:pb-6 lg:px-12">
          {/* The dashed box. Its rule between the columns is the same
              dashed hairline the hero and section 4 use, which is what
              ties this band back to the rest of the page despite being
              the only coloured surface on it. */}
          <div className="grid rounded-surface border border-dashed border-primary-foreground/30 lg:grid-cols-2">
            <div className="flex items-center justify-center px-6 py-10 sm:px-10 sm:py-14">
              {/*
                Where the reference puts two photographs. Same gradient
                field as everywhere else on this page stands in for them,
                and reading as a pale object against the accent is exactly
                what the photographs do there.
              */}
              {/* The reveal lives on a wrapper rather than on the card:
                  `[data-reveal]` owns `transform`, and the circle needs a
                  translate of its own to sit below the square. */}
              <span data-reveal="media" className="block">
                <MediaCard
                  seed={41}
                  radius="rounded-[1.75rem]"
                  tone="light"
                  className="size-36 sm:size-48"
                />
              </span>
              <span data-reveal="media" className="-ml-7 block sm:-ml-9">
                <MediaCard
                  seed={57}
                  radius="rounded-full"
                  tone="light"
                  className="size-32 translate-y-6 sm:size-44"
                />
              </span>
            </div>

            <div className="flex flex-col justify-center border-t border-dashed border-primary-foreground/30 px-6 py-10 sm:px-10 sm:py-14 lg:border-t-0 lg:border-l">
              <h2 className="max-w-[16ch] text-[clamp(2rem,3.6vw,3.2rem)] leading-[1.02] font-medium tracking-[-0.03em]">
                {CTA.heading.map((line) => (
                  <span key={line} data-reveal="heading" className="block">
                    {line}
                  </span>
                ))}
              </h2>

              <p
                data-reveal="support"
                className="mt-5 max-w-[32rem] text-[0.95rem] leading-relaxed text-primary-foreground/75 text-pretty"
              >
                {CTA.support}
              </p>

              <div data-reveal="action" className="mt-9">
                {/*
                  `raised`, not `action`. On this band the near-black
                  `action` tone is the one thing that would disappear into
                  nothing - white on the accent is the contrast the
                  reference uses, and `raised` is already exactly that.
                */}
                <Button
                  tone="raised"
                  nativeButton={false}
                  className="h-13 px-8 text-[0.95rem]"
                  render={<Link href={CTA.action.href} />}
                >
                  {CTA.action.label}
                </Button>
              </div>
            </div>
          </div>

          <div
            data-footer
            className="mt-16 grid gap-12 sm:mt-20 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,1fr)] lg:gap-14"
          >
            <div data-reveal="foot">
              <p className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-foreground text-primary">
                  <Wifi className="size-4" />
                </span>
                <span className="text-xl font-medium tracking-[-0.02em]">
                  {BRAND}
                </span>
              </p>
              <p className="mt-5 max-w-[28rem] text-sm leading-relaxed text-primary-foreground/70 text-pretty">
                {FOOTER.blurb}
              </p>
            </div>

            <nav data-reveal="foot" aria-label="Footer">
              <p className="text-xs font-medium tracking-[0.12em] text-primary-foreground/60 uppercase">
                {links.heading}
              </p>
              <ul className="mt-5 flex flex-col gap-3 text-sm">
                {links.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="transition-colors hover:text-primary-foreground/60"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div data-reveal="foot">
              <p className="text-xs font-medium tracking-[0.12em] text-primary-foreground/60 uppercase">
                {contact.heading}
              </p>
              <a
                href={`mailto:${contact.email}`}
                className="mt-4 inline-block text-lg font-medium break-all underline decoration-primary-foreground/40 underline-offset-[6px] transition-colors hover:decoration-primary-foreground sm:text-xl"
              >
                {contact.email}
              </a>

              <p className="mt-8 text-xs font-medium tracking-[0.12em] text-primary-foreground/60 uppercase">
                {contact.secondary.heading}
              </p>
              <Link
                href={contact.secondary.href}
                className="group mt-3 inline-flex items-center gap-2 text-sm underline underline-offset-[6px] decoration-primary-foreground/40 transition-colors hover:decoration-primary-foreground"
              >
                {contact.secondary.label}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </div>

          <div
            data-reveal="foot"
            className="mt-14 flex items-center justify-between border-t border-dashed border-primary-foreground/25 pt-6 text-xs text-primary-foreground/60"
          >
            <p>{footerLegal()}</p>
            <div className="flex gap-4">
              {FOOTER.legalLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="hover:text-primary-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/*
            The oversized wordmark, cropped by the panel's own bottom edge.

            Sized in `cqw` against the padded column rather than in `vw`:
            the panel stops growing at the 1400px measure while the
            viewport does not, so a `vw` size kept growing past that point
            and ran the mark off both sides on a wide display.

            `aria-hidden` and not a heading. It is the brand name set as a
            texture, and it is already the first thing in the footer above
            as real text.
          */}
          <p
            data-wordmark
            aria-hidden
            className="pointer-events-none mt-10 text-center text-[25.5cqw] leading-[0.78] font-medium tracking-[-0.045em] whitespace-nowrap text-primary-foreground/15 select-none"
          >
            {BRAND}
          </p>
        </div>
      </div>
    </CtaMotion>
  );
}
