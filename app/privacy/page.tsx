import { LegalPage } from "@/components/legal/legal-page";
import { PRIVACY_POLICY } from "@/lib/legal-data";
import { BRAND } from "@/lib/landing-content";
import { indexable } from "@/lib/seo";

export const metadata = {
  title: `Privacy Policy - ${BRAND}`,
  description:
    "How we collect, use and protect your personal information when you use our hotspot management platform.",
  ...indexable("/privacy"),
};

export default function PrivacyPage() {
  return <LegalPage document={PRIVACY_POLICY} />;
}
