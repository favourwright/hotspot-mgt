import { AnchorRedirect } from "@/components/developers/anchor-redirect";
import { DocPage } from "@/components/developers/doc-page";
import { docsView } from "@/lib/docs-view";
import { indexable } from "@/lib/seo";

export const metadata = {
  title: "Developers - OgaWiFi",
  description: "The OgaWiFi API, webhooks and decision hooks: every endpoint, event and field, generated from the code.",
  ...indexable("/developers"),
};

export default function DevelopersPage() {
  const view = docsView();
  return (
    <>
      {/* The docs were one page once; its #anchors still find their section. */}
      <AnchorRedirect hrefs={Object.fromEntries(view.sections.map((s) => [s.id, s.href]))} />
      <DocPage view={view} section={view.sections[0]} />
    </>
  );
}
