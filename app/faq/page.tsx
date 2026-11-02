import { FaqPageClient } from "@/components/faq/faq-page-client";
import { JsonLd } from "@/components/system/json-ld";
import { FAQ_CATEGORIES, faqBlockText } from "@/lib/faq-data";
import { BRAND } from "@/lib/landing-content";
import { indexable } from "@/lib/seo";

export const metadata = {
  title: `FAQ - ${BRAND}`,
  description:
    "Answers to common questions about buying vouchers and running a hotspot business, including connecting your MikroTik router.",
  ...indexable("/faq"),
};

export default function FaqPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ_CATEGORIES.flatMap((category) => category.entries).map((entry) => ({
            "@type": "Question",
            name: entry.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: entry.answer.map(faqBlockText).join(" "),
            },
          })),
        }}
      />
      <FaqPageClient />
    </>
  );
}
