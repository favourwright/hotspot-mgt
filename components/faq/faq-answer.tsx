import { AlertTriangle, ChevronRight, Info } from "lucide-react";
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

/**
 * FAQ copy describes RouterOS menu paths ("System > Packages > Check For
 * Updates"). Those arrows are an interface affordance, not punctuation, so
 * they render as icons -- but the copy lives in plain strings, so the split
 * happens here at render time rather than forcing every caption into a
 * rich-node shape.
 */
function WithMenuArrows({ text }: { text: string }) {
  const segments = text.split("\u2192");
  if (segments.length === 1) return <>{text}</>;

  return (
    <>
      {segments.map((segment, i) => (
        <span key={i}>
          {i > 0 && (
            <ChevronRight className="mx-0.5 inline size-3.5 shrink-0 align-[-0.15em]" />
          )}
          {i > 0 ? segment.trimStart() : segment.trimEnd()}
        </span>
      ))}
    </>
  );
}

function FaqBlockView({ block }: { block: FaqBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="text-sm text-muted-foreground">
          <WithMenuArrows text={block.text} />
        </p>
      );

    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>
              <WithMenuArrows text={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>
              <WithMenuArrows text={item} />
            </li>
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
          <p className="text-sm">
            <WithMenuArrows text={block.text} />
          </p>
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
                  <div className="text-sm text-muted-foreground">
                    <WithMenuArrows text={item.description} />
                  </div>
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
