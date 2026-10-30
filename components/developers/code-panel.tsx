"use client";

import { Fragment, useState, type ReactNode } from "react";
import { CopyButton } from "@/components/shared/copy-button";
import { cn } from "@/lib/utils";
import type { CodeSample } from "@/lib/docs-view";

/**
 * The dark code panel from the reference designs: a header, optional tabs,
 * line numbers, a copy button, and light syntax colouring.
 *
 * Dark in both themes on purpose: the theme's own dark token in light mode
 * (`bg-foreground`) and its raised surface in dark mode (`bg-card`), so it
 * stays a distinct panel either way. The colouring is a few regular
 * expressions rather than a highlighter package: the samples are JSON,
 * shell and a few lines of JavaScript, all generated, all short.
 */
export function CodePanel({
  header,
  samples,
  className,
}: {
  header: ReactNode;
  samples: CodeSample[];
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const sample = samples[Math.min(active, samples.length - 1)];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl bg-foreground text-background shadow-sm dark:bg-card dark:text-card-foreground dark:ring-1 dark:ring-border",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-background/10 px-4 py-2.5 dark:border-border">
        <div className="flex min-w-0 items-center gap-2 text-sm">{header}</div>
        <CopyButton
          value={sample.code}
          className="text-background/60 hover:bg-background/10 hover:text-background dark:text-card-foreground/60 dark:hover:bg-muted dark:hover:text-card-foreground"
        />
      </div>
      {samples.length > 1 && (
        <div role="tablist" className="flex gap-1 border-b border-background/10 px-3 pt-2 dark:border-border">
          {samples.map((s, i) => (
            <button
              key={s.label}
              role="tab"
              type="button"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "-mb-px rounded-t-lg border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                i === active
                  ? "border-primary text-background dark:text-card-foreground"
                  : "border-transparent text-background/50 hover:text-background/80 dark:text-card-foreground/50 dark:hover:text-card-foreground/80"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <pre className="max-h-[28rem] overflow-auto p-4 font-mono text-[0.8rem] leading-relaxed">
        <code className="grid grid-cols-[auto_1fr] gap-x-4">
          {sample.code.split("\n").map((line, i) => (
            <Fragment key={i}>
              <span className="select-none text-right text-background/30 dark:text-card-foreground/30">{i + 1}</span>
              <span className="whitespace-pre">{highlight(line, sample.language)}</span>
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}

const TOKEN = {
  key: "text-sky-300",
  string: "text-emerald-300",
  number: "text-amber-300",
  literal: "text-fuchsia-300",
  keyword: "text-violet-300",
  variable: "text-amber-200",
  comment: "text-background/40 dark:text-card-foreground/40",
};

function highlight(line: string, language: CodeSample["language"]): ReactNode {
  const rules: [RegExp, (m: RegExpExecArray) => keyof typeof TOKEN][] =
    language === "json"
      ? [
          [/"(?:\\.|[^"\\])*"(?=\s*:)/y, () => "key"],
          [/"(?:\\.|[^"\\])*"/y, () => "string"],
          [/-?\d+(?:\.\d+)?/y, () => "number"],
          [/\b(?:true|false|null)\b/y, () => "literal"],
        ]
      : language === "shell"
        ? [
            [/#.*/y, () => "comment"],
            [/"(?:\\.|[^"\\])*"/y, () => "string"],
            [/\$[A-Z_][A-Z0-9_]*/y, () => "variable"],
            [/\bcurl\b/y, () => "keyword"],
          ]
        : [
            [/\/\/.*/y, () => "comment"],
            [/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"/y, () => "string"],
            [/\b(?:const|await|return|function|new)\b/y, () => "keyword"],
            [/\b(?:process\.env\.[A-Z_]+)\b/y, () => "variable"],
          ];

  const out: ReactNode[] = [];
  let plain = "";
  let i = 0;
  outer: while (i < line.length) {
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(line);
      if (m && m[0].length > 0) {
        if (plain) out.push(plain);
        plain = "";
        out.push(
          <span key={i} className={TOKEN[kind(m)]}>
            {m[0]}
          </span>
        );
        i += m[0].length;
        continue outer;
      }
    }
    plain += line[i];
    i += 1;
  }
  if (plain) out.push(plain);
  return out;
}
