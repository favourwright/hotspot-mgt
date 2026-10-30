import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { PageHeader } from "@/components/system/page-header";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { Badge } from "@/components/ui/badge";
import { DocText } from "@/components/developers/doc-text";
import { SchemaFields, typeLabel } from "@/components/developers/schema-fields";
import { buildOpenApiDocument } from "@/lib/openapi";
import { docSections } from "@/lib/api-docs-content";

export const metadata = {
  title: "Developers - OgaWiFi",
  description: "The OgaWiFi API, webhooks and decision hooks: every endpoint, event and field, generated from the code.",
};

type Schema = Record<string, unknown>;
type Operation = {
  summary: string;
  description: string;
  parameters: { name: string; in: string; required: boolean; description?: string; schema: Schema }[];
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
  "x-required-scope": string;
};
type WebhookOp = {
  summary: string;
  description: string;
  requestBody: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: Schema }> }>;
};

/**
 * The developer reference. Everything on it comes from the OpenAPI document
 * built from the code (lib/openapi.ts) and the prose that reads the code's
 * own constants (lib/api-docs-content.ts), so it cannot drift from what the
 * API does. Nothing here is written by hand about any endpoint or field.
 */
export default function DevelopersPage() {
  const doc = buildOpenApiDocument(process.env.NEXT_PUBLIC_APP_URL || "https://ogawifi.online") as {
    servers: { url: string }[];
    paths: Record<string, Record<string, Operation>>;
    webhooks: Record<string, { post: WebhookOp }>;
    components: { schemas: Record<string, Schema> };
  };
  const components = doc.components.schemas;
  const sections = docSections();
  const base = doc.servers[0].url;

  const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ path, method: method.toUpperCase(), op }))
  );
  const resources = ["Plan", "Location", "Voucher", "Payment", "Customer"].filter((n) => components[n]);

  return (
    <AppShell>
      <PageContent>
        <PageHeader
          title="Developers"
          description={
            <>
              The OgaWiFi API, webhooks and decision hooks. Generated from the code on every deploy, so it always matches what
              the API does. Machine-readable:{" "}
              <a href="/api/v1/openapi.json" className="font-medium underline">
                openapi.json
              </a>
              .
            </>
          }
        />

        <nav className="flex flex-wrap gap-2 text-sm">
          {[...sections.map((s) => [s.id, s.title]), ["endpoints", "Endpoints"], ["webhooks-reference", "Webhooks reference"], ["resources", "Resources"]].map(
            ([id, title]) => (
              <a key={id} href={`#${id}`} className="rounded-full bg-foreground/5 px-3 py-1 hover:bg-foreground/10">
                {title}
              </a>
            )
          )}
        </nav>

        <div className="space-y-4">
          <SurfaceCard>
            <SurfaceCardContent className="space-y-1 text-sm">
              <p className="text-muted-foreground">Base URL</p>
              <code className="font-mono text-foreground">{base}</code>
            </SurfaceCardContent>
          </SurfaceCard>

          {sections.map((s) => (
            <SurfaceCard key={s.id} id={s.id}>
              <SurfaceCardHeader>
                <SurfaceCardTitle>{s.title}</SurfaceCardTitle>
              </SurfaceCardHeader>
              <SurfaceCardContent>
                <DocText text={s.body} />
              </SurfaceCardContent>
            </SurfaceCard>
          ))}

          <h2 id="endpoints" className="pt-4 text-lg font-semibold">
            Endpoints
          </h2>
          {operations.map(({ path, method, op }) => {
            const body = op.responses["200"]?.content?.["application/json"]?.schema;
            const data = (body?.properties as Record<string, Schema> | undefined)?.data;
            return (
              <SurfaceCard key={`${method} ${path}`} id={`${method.toLowerCase()}-${path.replace(/[^a-z0-9]+/gi, "-")}`}>
                <SurfaceCardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{method}</Badge>
                    <code className="font-mono text-sm font-medium">{path}</code>
                    <Badge variant="outline" className="font-mono">
                      {op["x-required-scope"]}
                    </Badge>
                  </div>
                  <SurfaceCardDescription>{op.summary}</SurfaceCardDescription>
                </SurfaceCardHeader>
                <SurfaceCardContent className="space-y-4">
                  <DocText text={op.description} />
                  {op.parameters.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">Parameters</h3>
                      <div className="divide-y divide-border/60 rounded-2xl border border-border/60">
                        {op.parameters.map((p) => (
                          <div key={`${p.in}:${p.name}`} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr] sm:gap-4">
                            <div>
                              <code className="font-mono text-xs font-medium">{p.name}</code>
                              <div className="text-xs text-muted-foreground">
                                {p.in}, {typeLabel(p.schema, components)}
                                {p.required ? ", required" : ""}
                              </div>
                            </div>
                            <div>{p.description ? <DocText text={p.description} /> : null}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {data && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">
                        Returns <code className="font-mono font-normal">data</code>: {typeLabel(data, components)}
                        {"nextCursor" in ((body?.properties as object) ?? {}) ? ", with nextCursor" : ""}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Fields under <a href="#resources" className="underline">Resources</a>.
                      </p>
                    </div>
                  )}
                </SurfaceCardContent>
              </SurfaceCard>
            );
          })}

          <h2 id="webhooks-reference" className="pt-4 text-lg font-semibold">
            Webhooks reference
          </h2>
          {Object.entries(doc.webhooks).map(([name, { post }]) => {
            const body = post.requestBody.content["application/json"].schema;
            const answer = post.responses["200"]?.content?.["application/json"]?.schema;
            const data = (body.properties as Record<string, Schema> | undefined)?.data;
            return (
              <SurfaceCard key={name} id={`event-${name}`}>
                <SurfaceCardHeader>
                  <code className="font-mono text-sm font-medium">{name}</code>
                </SurfaceCardHeader>
                <SurfaceCardContent className="space-y-4">
                  <DocText text={post.description} />
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">{data ? "data" : "Body"}</h3>
                    <SchemaFields schema={data ?? body} components={components} />
                  </div>
                  {answer && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">Your answer</h3>
                      {((answer.anyOf as Schema[] | undefined) ?? [answer]).map((variant, i) => (
                        <SchemaFields key={i} schema={variant} components={components} />
                      ))}
                    </div>
                  )}
                </SurfaceCardContent>
              </SurfaceCard>
            );
          })}

          <h2 id="resources" className="pt-4 text-lg font-semibold">
            Resources
          </h2>
          {resources.map((name) => (
            <SurfaceCard key={name} id={`resource-${name}`}>
              <SurfaceCardHeader>
                <SurfaceCardTitle>{name}</SurfaceCardTitle>
                {typeof components[name].description === "string" && (
                  <SurfaceCardDescription>{components[name].description as string}</SurfaceCardDescription>
                )}
              </SurfaceCardHeader>
              <SurfaceCardContent>
                <SchemaFields schema={{ $ref: `#/components/schemas/${name}` }} components={components} />
              </SurfaceCardContent>
            </SurfaceCard>
          ))}
        </div>
      </PageContent>
    </AppShell>
  );
}
