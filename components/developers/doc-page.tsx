import type { ReactNode } from "react";
import Link from "next/link";

import { CodePanel } from "@/components/developers/code-panel";
import { DocText, inline } from "@/components/developers/doc-text";
import { FieldList } from "@/components/developers/field-list";
import { MethodBadge } from "@/components/developers/method-badge";
import { SectionFooter } from "@/components/developers/section-footer";
import { GradientField } from "@/components/marketing/gradient-field";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { DocsSection, DocsView, ErrorGroup } from "@/lib/docs-view";
import { FORMAT_NOTE, INTRODUCTION } from "@/lib/api-docs-content";
import { cn } from "@/lib/utils";

/**
 * One page of the developer docs: a section from lib/docs-view.ts, laid out
 * after the agreed reference designs, with its feedback and Previous/Next.
 *
 * Every word about an endpoint, event or field comes from the code, through
 * lib/docs-view.ts; this file only arranges it.
 */
export function DocPage({ view, section }: { view: DocsView; section: DocsSection }) {
  const order = view.sections;
  const i = order.findIndex((s) => s.id === section.id);
  const prev = i > 0 ? order[i - 1] : null;
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  // Keyed, so moving between pages of the same route resets the answer state.
  const footer = (
    <SectionFooter
      key={section.id}
      sectionId={section.id}
      prev={prev && { href: prev.href, title: prev.title }}
      next={next && { href: next.href, title: next.title }}
    />
  );

  if (section.kind === "introduction") return <Introduction view={view} footer={footer} />;
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
      <SectionBody section={section} />
      {footer}
    </div>
  );
}

function Introduction({ view, footer }: { view: DocsView; footer: ReactNode }) {
  return (
    <>
      <div className="relative overflow-hidden bg-primary/8">
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 opacity-80 md:block" aria-hidden>
          <GradientField seed={7} count={14} animated={false} from={0} to={100} blur={8} tone="light" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-8">
          <p className="text-sm font-medium text-muted-foreground">Overview</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-primary sm:text-5xl">Introduction</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-foreground/80">{INTRODUCTION}</p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-14 sm:px-8">
        <div className="max-w-3xl space-y-3">
          <h2 className="text-xl font-semibold">Base URL</h2>
          <p className="text-sm text-muted-foreground">Every request goes to:</p>
          <CodePanel
            header={<span className="font-medium">Base URL</span>}
            samples={[{ label: "Base URL", language: "shell", code: view.baseUrl }]}
          />
        </div>

        <div className="max-w-3xl space-y-3">
          <h2 className="text-xl font-semibold">Request &amp; response format</h2>
          <DocText text={FORMAT_NOTE} />
          <p className="text-sm text-muted-foreground">Example response, from Get a voucher:</p>
          <CodePanel
            header={<span className="font-medium">JSON</span>}
            samples={[{ label: "JSON", language: "json", code: view.exampleResponse }]}
          />
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Available endpoints</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.endpoints.map((e) => (
              <Link
                key={e.id}
                href={e.href}
                className="space-y-2 rounded-3xl border border-border/70 p-4 transition-colors hover:bg-muted/50"
              >
                <span className="flex items-center gap-2">
                  <MethodBadge method={e.method} />
                  <code className="truncate font-mono text-sm">{e.path}</code>
                </span>
                <span className="block text-sm text-muted-foreground">{e.summary}</span>
              </Link>
            ))}
          </div>
        </div>

        {footer}
      </div>
    </>
  );
}

function Heading({ group, title, mono }: { group: string; title: string; mono?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{group}</p>
      <h1 className={cn("text-3xl font-semibold tracking-tight", mono && "font-mono text-2xl")}>{title}</h1>
    </div>
  );
}

/** Content on the left, sticky dark code panels on the right, as in the references. */
function TwoColumn({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="min-w-0 space-y-8">{left}</div>
      <div className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">{right}</div>
    </div>
  );
}

function SectionBody({ section }: { section: Exclude<DocsSection, { kind: "introduction" }> }) {
  if (section.kind === "prose") {
    return (
      <div className="max-w-3xl space-y-6">
        <Heading group={section.group} title={section.title} />
        <DocText text={section.body} />
      </div>
    );
  }

  if (section.kind === "endpoint") {
    const path = section.params.filter((p) => p.in === "path");
    const query = section.params.filter((p) => p.in === "query");
    return (
      <TwoColumn
        left={
          <>
            <Heading group={section.group} title={section.title} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <MethodBadge method={section.method} />
              <code className="font-mono">{section.path}</code>
              <span className="text-muted-foreground">needs</span>
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">{section.scope}</code>
            </div>
            <DocText text={section.description} />
            {path.length > 0 && (
              <Block title="Path parameters">
                <FieldList fields={path} showRequired />
              </Block>
            )}
            {query.length > 0 && (
              <Block title="Query parameters">
                <FieldList fields={query} showRequired />
              </Block>
            )}
            <Block title="Response">
              <Accordion multiple defaultValue={["200"]}>
                <AccordionItem value="200">
                  <ResponseTrigger status="200" label="Successful response" />
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      <code className="font-mono text-foreground">data</code>: {section.response.label}
                    </p>
                    <FieldList fields={section.response.fields} />
                  </AccordionContent>
                </AccordionItem>
                {section.errors.map((e) => (
                  <ErrorItem key={e.status} error={e} />
                ))}
              </Accordion>
            </Block>
          </>
        }
        right={
          <>
            <CodePanel
              header={
                <>
                  <MethodBadge method={section.method} onDark />
                  <code className="truncate font-mono">{section.path}</code>
                </>
              }
              samples={section.samples}
            />
            <CodePanel
              header={
                <>
                  <StatusBadge status="200" onDark />
                  <span className="font-medium">Successful response</span>
                </>
              }
              samples={[{ label: "JSON", language: "json", code: section.example }]}
            />
          </>
        }
      />
    );
  }

  if (section.kind === "event") {
    return (
      <TwoColumn
        left={
          <>
            <Heading group={section.group} title={section.title} mono />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MethodBadge method={section.badge} />
              {section.badge === "HOOK" ? "We ask your decision hook; your answer decides." : "We POST this to your endpoints."}
            </div>
            <DocText text={section.description} />
            <Block title={section.badge === "HOOK" ? "Request body" : "data"}>
              <FieldList fields={section.fields} />
            </Block>
            {section.answers.map((a) => (
              <Block key={a.label} title={`Your answer: ${a.label.toLowerCase()}`}>
                <FieldList fields={a.fields} />
              </Block>
            ))}
          </>
        }
        right={
          <>
            <CodePanel
              header={
                <>
                  <MethodBadge method={section.badge} onDark />
                  <span className="truncate font-mono">POST to your URL</span>
                </>
              }
              samples={[{ label: "JSON", language: "json", code: section.example }]}
            />
            {section.answers.map((a) => (
              <CodePanel
                key={a.label}
                header={
                  <>
                    <StatusBadge status="200" onDark />
                    <span className="font-medium">{a.label}</span>
                  </>
                }
                samples={[{ label: "JSON", language: "json", code: a.example }]}
              />
            ))}
          </>
        }
      />
    );
  }

  return (
    <TwoColumn
      left={
        <>
          <Heading group={section.group} title={section.title} />
          {section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
          <Block title="Fields">
            <FieldList fields={section.fields} />
          </Block>
        </>
      }
      right={
        <CodePanel
          header={<span className="font-medium">{section.title}</span>}
          samples={[{ label: "JSON", language: "json", code: section.example }]}
        />
      }
    />
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-border/60 pt-6">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function StatusBadge({ status, onDark = false }: { status: string; onDark?: boolean }) {
  const ok = status.startsWith("2");
  const warn = status === "429" || status === "402";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 font-mono text-xs font-semibold",
        ok
          ? onDark
            ? "bg-emerald-400/15 text-emerald-400"
            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : warn
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-red-500/15 text-red-600 dark:text-red-400"
      )}
    >
      {status}
    </span>
  );
}

function ResponseTrigger({ status, label }: { status: string; label: string }) {
  return (
    <AccordionTrigger className="items-center gap-3 px-4 py-3 hover:no-underline">
      <span className="flex flex-1 items-center gap-3">
        <StatusBadge status={status} />
        {label}
      </span>
    </AccordionTrigger>
  );
}

const STATUS_LABELS: Record<string, string> = {
  "400": "Bad request",
  "401": "Not authenticated",
  "402": "Addon not active",
  "403": "Missing permission",
  "404": "Not found",
  "429": "Too many requests",
  "500": "Server error",
};

function ErrorItem({ error }: { error: ErrorGroup }) {
  return (
    <AccordionItem value={error.status}>
      <ResponseTrigger status={error.status} label={STATUS_LABELS[error.status] ?? "Error"} />
      <AccordionContent>
        <ul className="space-y-2 text-sm">
          {error.codes.map((c) => (
            <li key={c.code} className="space-y-0.5">
              <code className="font-mono text-sm font-semibold text-primary">{c.code}</code>
              <p className="text-muted-foreground">{inline(c.meaning)}</p>
            </li>
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>
  );
}
