import type { MetadataRoute } from "next";

import { docsView } from "@/lib/docs-view";
import { SITE_URL } from "@/lib/seo";

/**
 * The platform's own public pages. Tenant home pages are left out: reading them
 * needs Firestore, which the build does not have, and a sitemap on the apex
 * cannot vouch for URLs on another host anyway.
 *
 * No `lastModified`: nothing here tracks it, and a date that is always "now"
 * teaches crawlers to ignore the field.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/faq",
    "/privacy",
    "/acceptable-use",
    ...docsView().sections.map((section) => section.href),
  ];
  return paths.map((path) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
  }));
}
