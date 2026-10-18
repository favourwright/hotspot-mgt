import { ContentRenderer } from "@/components/content/content-renderer";
import { type LegalBlock } from "@/lib/legal-data";

export function LegalBody({ blocks }: { blocks: LegalBlock[] }) {
  return <ContentRenderer blocks={blocks} />;
}
