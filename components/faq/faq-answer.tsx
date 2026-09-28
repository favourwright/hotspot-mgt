import { AlertTriangle, Info } from "lucide-react";
import { CopyButton } from "@/components/shared/copy-button";
import { FaqBlock } from "@/lib/faq-data";

export function FaqAnswer({ blocks }: { blocks: FaqBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <FaqBlockView key={index} block={block} />
      ))}
    </div>
  );
}

function FaqBlockView({ block }: { block: FaqBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className="text-sm text-muted-foreground">{block.text}</p>;

    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );

    case "command":
      return (
        <div className="space-y-1">
          <div className="relative">
            <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-12 font-mono text-sm">
              {block.command}
            </pre>
            <CopyButton value={block.command} className="absolute top-2 right-2" />
          </div>
          {block.note && (
            <p className="text-xs text-muted-foreground">{block.note}</p>
          )}
        </div>
      );

    case "callout": {
      const Icon = block.tone === "warning" ? AlertTriangle : Info;
      return (
        <div className="flex gap-2 rounded-md border-l-4 border-primary bg-primary/5 p-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm">{block.text}</p>
        </div>
      );
    }

    case "steps":
      return (
        <ol className="space-y-3">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {i + 1}
              </div>
              <div>
                <div className="text-sm font-medium">{item.title}</div>
                {item.description && (
                  <div className="text-sm text-muted-foreground">{item.description}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      );

    default:
      return null;
  }
}
