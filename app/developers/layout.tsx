import type { ReactNode } from "react";

import { DocsShell } from "@/components/developers/docs-shell";
import { docsView } from "@/lib/docs-view";
import { BRAND, FOOTER } from "@/lib/landing-content";

/** The frame every docs page shares: sidebar, search and top bar. */
export default function DevelopersLayout({ children }: { children: ReactNode }) {
  const view = docsView();
  return (
    <DocsShell brand={`${BRAND} Docs`} nav={view.nav} search={view.search} supportEmail={FOOTER.contact.email}>
      {children}
    </DocsShell>
  );
}
