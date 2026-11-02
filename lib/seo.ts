import type { Metadata } from "next";

/** The public origin. Every canonical URL and the sitemap are built on it. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://ogawifi.online"
).replace(/\/$/, "");

/**
 * The opt-in for search engines. The root layout marks everything `noindex`,
 * so an admin page, a voucher page or anything added later stays out of search
 * unless its own metadata spreads this in.
 *
 * The canonical matters because these pages answer on every host: the apex,
 * `www`, any tenant subdomain and the bare IP. `path` resolves against
 * `metadataBase`, so all of them point at the apex. Never set this in a layout:
 * children inherit it and would all claim to be that one URL.
 *
 * Do not add `openGraph` here: a child's replaces the root's whole object,
 * which would drop the share image.
 */
export function indexable(path: string): Metadata {
  return {
    robots: { index: true, follow: true },
    alternates: { canonical: path },
  };
}
