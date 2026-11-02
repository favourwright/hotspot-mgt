import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

/**
 * Only the API is blocked. Private pages are kept out of search by their
 * `noindex` (see lib/seo.ts), and a crawler has to be allowed to fetch a page
 * to read that: blocking `/admin` here could leave its URL listed in results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
