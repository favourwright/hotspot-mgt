import { ContentRenderer } from "@/components/content/content-renderer";
import { FaqBlock } from "@/lib/faq-data";

export function FaqAnswer({ blocks }: { blocks: FaqBlock[] }) {
  return <ContentRenderer blocks={blocks} />;
}
