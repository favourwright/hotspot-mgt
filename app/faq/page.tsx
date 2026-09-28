import { FaqPageClient } from "@/components/faq/faq-page-client";

export const metadata = {
  title: "FAQ - Hotspot Manager",
  description:
    "Answers to common questions about buying vouchers and running a hotspot business, including connecting your MikroTik router.",
};

export default function FaqPage() {
  return <FaqPageClient />;
}
