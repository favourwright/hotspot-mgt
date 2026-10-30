"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /developers was a single page, so links and bookmarks to
 * /developers#get-vouchers exist. This sends them to that section's page.
 */
export function AnchorRedirect({ hrefs }: { hrefs: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const href = hrefs[window.location.hash.slice(1)];
    if (href && href !== "/developers") router.replace(href);
  }, [hrefs, router]);
  return null;
}
