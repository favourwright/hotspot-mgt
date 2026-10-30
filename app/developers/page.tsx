import type { ReactNode } from "react";

import { DocsShell } from "@/components/developers/docs-shell";
import { CodePanel } from "@/components/developers/code-panel";
import { DocText } from "@/components/developers/doc-text";
import { FieldList } from "@/components/developers/field-list";
import { MethodBadge } from "@/components/developers/method-badge";
import { SectionFooter } from "@/components/developers/section-footer";
import { GradientField } from "@/components/marketing/gradient-field";
import { buildDocsView, type DocsSection, type ErrorGroup } from "@/lib/docs-view";
import { FORMAT_NOTE, INTRODUCTION } from "@/lib/api-docs-content";
import { BRAND, FOOTER } from "@/lib/landing-content";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Developers - OgaWiFi",
  description: "The OgaWiFi API, webhooks and decision hooks: every endpoint, event and field, generated from the code.",
};

/**
 * The developer reference, laid out after the agreed reference designs: a
 * dark sidebar, a search bar, and sections with sticky dark code panels.
 *
 * Every word about an endpoint, event or field comes from the code, through
 * lib/docs-view.ts; this file only arranges it.
 */
export default function DevelopersPage() {
  const view = buildDocsView(process.env.NEXT_PUBLIC_APP_URL || "https://ogawifi.online");
  const order = view.sections;

  return (
    <DocsShell brand={`${BRAND} Docs`} nav={view.nav} search={view.search} supportEmail={FOOTER.contact.email}>
      {order.map((section, i) => {
        const footer = (
          <SectionFooter
            sectionId={section.id}
            prev={i > 0 ? { id: order[i - 1].id, title: order[i - 1].title } : null}
            next={i < order.length - 1 ? { id: order[i + 1].id, title: order[i + 1].title } : null}
          />
        );
        return (
          <section
            key={section.id}
            id={section.id}
            data-doc-section
            className="scroll-mt-16 border-b border-border/60 last:border-b-0"
          >
            {section.kind === "introduction" ? (
              <Introduction view={view} footer={footer} />
            ) : (
              <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
                <SectionBody section={section} />
                <div className={cn(section.kind !== "prose" && "lg:max-w-[calc(100%-30rem)]")}>{footer}</div>
              </div>
            )}
          </section>
        );
      })}
    </DocsShell>
  );
}

function Introduction({ view, footer }: { view: ReturnType<typeof buildDocsView>; footer: ReactNode }) {
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
              <a
                key={e.id}
                href={`#${e.id}`}
                className="space-y-2 rounded-3xl border border-border/70 p-4 transition-colors hover:bg-muted/50"
              >
                <span className="flex items-center gap-2">
                  <MethodBadge method={e.method} />
                  <code className="truncate font-mono text-sm">{e.path}</code>
                </span>
                <span className="block text-sm text-muted-foreground">{e.summary}</span>
              </a>
            ))}
          </div>
        </div>

        <div className="max-w-3xl">{footer}</div>
      </div>
    </>
  );
}

function Heading({ group, title, mono }: { group: string; title: string; mono?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{group}</p>
      <h2 className={cn("text-3xl font-semibold tracking-tight", mono && "font-mono text-2xl")}>{title}</h2>
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
              <div className="overflow-hidden rounded-3xl border border-border/70">
                <details open className="group">
                  <Summary status="200" label="Successful response" />
                  <div className="space-y-3 border-t border-border/60 px-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      <code className="font-mono text-foreground">data</code>: {section.response.label}
                    </p>
                    <FieldList fields={section.response.fields} />
                  </div>
                </details>
                {section.errors.map((e) => (
                  <ErrorDetails key={e.status} error={e} />
                ))}
              </div>
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

function Summary({ status, label }: { status: string; label: string }) {
  return (
    <summary className="flex cursor-pointer list-none items-center gap-3 bg-muted/40 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
      <StatusBadge status={status} />
      <span className="flex-1">{label}</span>
      <span className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden>
        &#8964;
      </span>
    </summary>
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

function ErrorDetails({ error }: { error: ErrorGroup }) {
  return (
    <details className="group border-t border-border/60">
      <Summary status={error.status} label={STATUS_LABELS[error.status] ?? "Error"} />
      <ul className="space-y-2 border-t border-border/60 px-4 py-4 text-sm">
        {error.codes.map((c) => (
          <li key={c.code} className="space-y-0.5">
            <code className="font-mono text-sm font-semibold text-primary">{c.code}</code>
            <p className="text-muted-foreground">
              <DocTextInline text={c.meaning} />
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function DocTextInline({ text }: { text: string }) {
  return <DocText text={text} className="inline text-sm text-muted-foreground" />;
}
