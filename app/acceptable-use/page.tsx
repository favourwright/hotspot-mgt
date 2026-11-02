import { LegalPage } from "@/components/legal/legal-page";
import { ACCEPTABLE_USE_POLICY } from "@/lib/legal-data";
import { BRAND } from "@/lib/landing-content";
import { indexable } from "@/lib/seo";

export const metadata = {
  title: `Acceptable Use Policy - ${BRAND}`,
  description:
    "The rules for using this platform, for both businesses operating a hotspot and customers buying access.",
  ...indexable("/acceptable-use"),
};

export default function AcceptableUsePage() {
  return <LegalPage document={ACCEPTABLE_USE_POLICY} />;
}
