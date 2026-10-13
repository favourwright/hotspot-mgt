import { Suspense } from "react";

import { PageContent } from "@/components/system/page-content";
import { AuthAction } from "@/components/auth/auth-action";

/**
 * Where every Firebase email action link lands.
 *
 * Firebase's own handler at `<project>.firebaseapp.com/__/auth/action` works
 * perfectly well; the only thing wrong with it is that it is not ours, and it
 * is reached from emails that are. Pointing the templates at this page is a
 * console setting, not code - see docs/auth-and-security.md, including the
 * deploy ordering, because flipping that setting before this page is live
 * breaks every action link at once, password resets included.
 *
 * It lives on the apex and nowhere else. Firebase's authorized-domain list
 * takes no wildcards, so a per-tenant subdomain could never be listed; one
 * fixed URL is authorised once and serves every tenant. Getting back to a
 * subdomain afterwards is our own redirect.
 */
export const metadata = {
  title: "Confirming...",
  // Nothing here should ever be indexed: every URL carries a one-time code.
  robots: { index: false, follow: false },
};

export default function AuthActionPage() {
  return (
    <PageContent width="prose" className="py-10">
      {/* The whole page reads the query string, so the boundary wraps all of
          it rather than a fragment. */}
      <Suspense fallback={null}>
        <AuthAction />
      </Suspense>
    </PageContent>
  );
}
