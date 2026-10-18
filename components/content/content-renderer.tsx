import Link from "next/link";
import { AlertTriangle, ChevronRight, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/shared/copy-button";

// Generic inline content types
export type InlineContent = string | { label: string; href: string };

// Generic block types
export type ContentBlock =
  | { type: "paragraph"; text: string | InlineContent[] }
  | {
      type: "list";
      ordered?: boolean;
      items: (string | InlineContent[])[];
    }
  | { type: "command"; command: string; note?: string }
  | { type: "callout"; tone?: "info" | "warning"; text: string | InlineContent[] }
  | {
      type: "steps";
      items: { title: string; description?: string }[];
    }
  | {
      type: "definitions";
      items: { term: string; text: InlineContent[] }[];
    }
  | {
      type: "table";
      head: string[];
      rows: InlineContent[][][];
    };

interface ContentRendererProps {
  blocks: ContentBlock[];
}

export function ContentRenderer({ blocks }: ContentRendererProps) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <ContentBlockView key={index} block={block} />
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

function renderInline(inline: InlineContent): React.ReactNode {
  if (typeof inline === "string") return inline;

  const isExternal =
    inline.href.startsWith("http") || inline.href.startsWith("mailto:");

  if (isExternal) {
    return (
      <a
        href={inline.href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:text-foreground"
      >
        {inline.label}
      </a>
    );
  }

  return (
    <Link
      href={inline.href}
      className="underline underline-offset-4 hover:text-foreground"
    >
      {inline.label}
    </Link>
  );
}

function renderInlineArray(inlines: InlineContent[]): React.ReactNode {
  return inlines.map((inline, i) => (
    <span key={i}>{renderInline(inline)}</span>
  ));
}

function renderTextContent(text: string | InlineContent[]): React.ReactNode {
  if (typeof text === "string") {
    return <WithMenuArrows text={text} />;
  }
  return renderInlineArray(text);
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="text-sm text-muted-foreground">
          {renderTextContent(block.text)}
        </p>
      );

    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>{renderTextContent(item)}</li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>{renderTextContent(item)}</li>
          ))}
        </ul>
      );

    case "command":
      return (
        <div className="space-y-1">
          <div className="relative">
            <pre className="overflow-x-auto rounded-panel bg-foreground/5 p-4 pr-12 font-mono text-sm">
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
      const warning = block.tone === "warning";
      const Icon = warning ? AlertTriangle : Info;
      return (
        <div className="flex items-center gap-3 rounded-panel bg-foreground/5 p-4">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg",
              warning
                ? "bg-rose-500/15 text-rose-600"
                : "bg-raised text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
          </span>
          <p className="text-sm">{renderTextContent(block.text)}</p>
        </div>
      );
    }

    case "steps":
      return (
        <ol className="space-y-3">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <div className="grid size-6 shrink-0 place-items-center rounded-lg bg-foreground/5 text-xs font-semibold">
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

    case "definitions":
      return (
        <dl className="space-y-3">
          {block.items.map((item, i) => (
            <div key={i}>
              <dt className="text-sm font-semibold">{item.term}</dt>
              <dd className="text-sm text-muted-foreground">
                {renderInlineArray(item.text)}
              </dd>
            </div>
          ))}
        </dl>
      );

    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {block.head.map((heading, i) => (
                  <th
                    key={i}
                    className="pb-2 pr-4 text-left font-semibold last:pr-0"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="py-2 pr-4 align-top text-muted-foreground last:pr-0"
                    >
                      {renderInlineArray(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return null;
  }
}
