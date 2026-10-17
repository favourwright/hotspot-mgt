import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { type LegalBlock, type LegalInline } from "@/lib/legal-data";

export function LegalBody({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <LegalBlockView key={index} block={block} />
      ))}
    </div>
  );
}

function renderInline(inline: LegalInline): React.ReactNode {
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

function renderInlineArray(inlines: LegalInline[]): React.ReactNode {
  return inlines.map((inline, i) => (
    <span key={i}>{renderInline(inline)}</span>
  ));
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="text-sm text-muted-foreground">
          {renderInlineArray(block.text)}
        </p>
      );

    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>{renderInlineArray(item)}</li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>{renderInlineArray(item)}</li>
          ))}
        </ul>
      );

    case "callout": {
      const warning = block.tone === "warning";
      const Icon = warning ? AlertTriangle : Info;
      return (
        <div className="flex items-center gap-3 rounded-panel bg-sunken p-4">
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
          <p className="text-sm">{renderInlineArray(block.text)}</p>
        </div>
      );
    }

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
