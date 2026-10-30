import { Fragment, type ReactNode } from "react";
import { CodePanel } from "@/components/developers/code-panel";

/**
 * The small Markdown subset lib/api-docs-content.ts and the schemas'
 * descriptions are written in: paragraphs, `- ` lists, fenced code blocks,
 * `code` and **bold**.
 * Rendered as React nodes, never as HTML, so no text in the docs can inject
 * markup.
 */
type Block = { kind: "code"; text: string } | { kind: "text"; text: string };

/** Fenced code first, so a blank line inside a code block does not split it. */
function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  const parts = text.trim().split(/^```[a-z]*\n?/m);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push({ kind: "code", text: part.replace(/\n$/, "") });
    } else {
      for (const para of part.trim().split(/\n{2,}/)) if (para.trim()) out.push({ kind: "text", text: para });
    }
  });
  return out;
}

export function DocText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? "space-y-3 text-sm leading-relaxed text-muted-foreground"}>
      {blocksOf(text).map((b, i) => {
        if (b.kind === "code") {
          return (
            <CodePanel
              key={i}
              className="my-4"
              header={<span className="font-medium">JavaScript</span>}
              samples={[{ label: "JavaScript", language: "js", code: b.text }]}
            />
          );
        }
        const block = b.text;
        const lines = block.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

export function inline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
