/**
 * What the /developers pages render, derived from the generated OpenAPI document and
 * the prose module. Nothing here is written about any endpoint: the page's
 * sections, its sidebar, its search index and its code samples are all
 * built from what lib/openapi.ts collected from the code.
 */

import { buildOpenApiDocument } from "@/lib/openapi";
import { docSections } from "@/lib/api-docs-content";
import { exampleFor } from "@/lib/api-examples";

type Schema = Record<string, unknown>;

export type Badge = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "EVENT" | "HOOK";

export interface Field {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  description: string | null;
  example: string | null;
}

export interface ErrorGroup {
  status: string;
  codes: { code: string; meaning: string }[];
}

export interface CodeSample {
  label: string;
  language: "shell" | "js" | "json";
  code: string;
}

type SectionContent =
  | { kind: "introduction"; id: string; title: string; group: string }
  | { kind: "prose"; id: string; title: string; group: string; body: string }
  | {
      kind: "endpoint";
      id: string;
      title: string;
      group: string;
      method: Badge;
      path: string;
      description: string;
      scope: string;
      params: (Field & { in: string })[];
      response: { label: string; fields: Field[]; resource: string | null; list: boolean };
      errors: ErrorGroup[];
      samples: CodeSample[];
      example: string;
    }
  | {
      kind: "event";
      id: string;
      title: string;
      group: string;
      badge: Badge;
      description: string;
      fields: Field[];
      example: string;
      answers: { label: string; fields: Field[]; example: string }[];
    }
  | { kind: "resource"; id: string; title: string; group: string; description: string; fields: Field[]; example: string };

/** One docs page: a section and the URL it lives at. */
export type DocsSection = SectionContent & { href: string };

export interface NavItem {
  id: string;
  href: string;
  label: string;
  badge?: Badge;
}

export interface NavGroup {
  title: string;
  /** A collapsible sub-group, like the endpoints of one resource. */
  sub?: string;
  items: NavItem[];
}

export interface SearchEntry {
  id: string;
  href: string;
  title: string;
  group: string;
  badge?: Badge;
  text: string;
}

export interface DocsView {
  baseUrl: string;
  sections: DocsSection[];
  nav: NavGroup[];
  search: SearchEntry[];
  endpoints: { id: string; href: string; method: Badge; path: string; summary: string }[];
  exampleResponse: string;
}

const OVERVIEW_IDS = ["authentication", "responses", "paging", "limits", "signatures"];

let cached: { origin: string; view: DocsView } | null = null;

/** The docs for this deployment's origin, built once per process. */
export function docsView(): DocsView {
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://ogawifi.online";
  if (cached?.origin !== origin) cached = { origin, view: buildDocsView(origin) };
  return cached.view;
}

/**
 * Where a section lives. Ids are unique on their own; the URL adds the group
 * so it reads as a path, and drops the prefix the id carries for uniqueness.
 */
function hrefFor(s: SectionContent): string {
  switch (s.kind) {
    case "introduction":
      return "/developers";
    case "prose":
      if (s.group !== "Webhooks") return `/developers/${s.id}`;
      return s.id === "webhooks" ? "/developers/webhooks" : `/developers/webhooks/${s.id}`;
    case "endpoint":
      return `/developers/endpoints/${s.id}`;
    case "event":
      return `/developers/webhooks/${s.id.replace(/^(event|hook)-/, "").replace(/_/g, "-")}`;
    case "resource":
      return `/developers/resources/${s.id.replace(/^resource-/, "")}`;
  }
}

export function buildDocsView(origin: string): DocsView {
  const doc = buildOpenApiDocument(origin) as {
    servers: { url: string }[];
    paths: Record<string, Record<string, Operation>>;
    webhooks: Record<string, { post: WebhookOp }>;
    components: { schemas: Record<string, Schema>; responses: Record<string, { description: string }> };
  };
  const components = doc.components.schemas;
  const baseUrl = doc.servers[0].url;
  const prose = docSections();
  const proseById = new Map(prose.map((p) => [p.id, p]));

  const sections: SectionContent[] = [{ kind: "introduction", id: "introduction", title: "Introduction", group: "Overview" }];
  // Nav, search and endpoint entries get their href once every section exists.
  const nav: NavGroup[] = [{ title: "Overview", items: [{ id: "introduction", href: "", label: "Introduction" }] }];

  for (const id of OVERVIEW_IDS) {
    const p = proseById.get(id);
    if (!p) continue;
    sections.push({ kind: "prose", id: p.id, title: p.title, group: "Overview", body: p.body });
    nav[0].items.push({ id: p.id, href: "", label: p.title });
  }

  // Endpoints, grouped by their first path segment, in a stable order.
  const endpoints: DocsView["endpoints"] = [];
  const byTag = new Map<string, SectionContent[]>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? "other";
      const id = `${method}-${path}`.replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "").toLowerCase();
      const response = op.responses["200"]?.content?.["application/json"]?.schema ?? {};
      const data = ((response.properties as Record<string, Schema> | undefined) ?? {}).data ?? {};
      const list = "nextCursor" in ((response.properties as object) ?? {});
      const item = (data.items as Schema | undefined) ?? data;
      const resource = refName(item);
      // A 400 lists only what can go wrong with this endpoint's own
      // parameters, not every parameter of every endpoint.
      const queryNames = new Set(op.parameters.filter((p) => p.in === "query").map((p) => p.name));
      const errors = Object.keys(op.responses)
        .filter((s) => s !== "200")
        .map((status) => ({
          status,
          codes: parseCodes(doc.components.responses[`E${status}`]?.description ?? "").filter(
            (c) => !c.code.startsWith("invalid_") || queryNames.has(c.code.slice("invalid_".length))
          ),
        }));

      const section: SectionContent = {
        kind: "endpoint",
        id,
        title: op.summary,
        group: titleCase(tag),
        method: method.toUpperCase() as Badge,
        path,
        description: op.description,
        scope: op["x-required-scope"],
        params: op.parameters.map((p) =>
          p.in === "path"
            ? {
                ...fieldOf(p.name, p.schema, components, true),
                in: p.in,
                description: `The ${tag.replace(/s$/, "")}'s ${p.name}`,
                example: null,
              }
            : { ...fieldOf(p.name, p.schema, components, p.required), in: p.in, description: p.description ?? null }
        ),
        response: {
          label: list ? `List of ${resource ?? "items"}, with nextCursor` : (resource ?? "Data"),
          fields: fieldsOf(resource ? { $ref: `#/components/schemas/${resource}` } : item, components),
          resource,
          list,
        },
        errors,
        samples: samples(baseUrl, method.toUpperCase(), path, tag, list),
        example: json(exampleFor(response, components)),
      };
      (byTag.get(tag) ?? byTag.set(tag, []).get(tag)!).push(section);
      endpoints.push({ id, href: "", method: method.toUpperCase() as Badge, path, summary: op.summary });
    }
  }
  for (const tag of [...byTag.keys()].sort()) {
    const list = byTag.get(tag)!.sort((a, b) => (a.kind === "endpoint" && b.kind === "endpoint" ? a.path.length - b.path.length : 0));
    sections.push(...list);
    nav.push({
      title: "Endpoints",
      sub: titleCase(tag),
      items: list.map((s) => ({ id: s.id, href: "", label: s.title, badge: s.kind === "endpoint" ? s.method : undefined })),
    });
  }

  // Webhooks: the overview, each event, then decision hooks.
  const webhookItems: NavItem[] = [];
  const webhooksProse = proseById.get("webhooks");
  if (webhooksProse) {
    sections.push({ kind: "prose", id: webhooksProse.id, title: webhooksProse.title, group: "Webhooks", body: webhooksProse.body });
    webhookItems.push({ id: webhooksProse.id, href: "", label: "How webhooks work" });
  }
  const hookEntries = Object.entries(doc.webhooks);
  for (const [name, { post }] of hookEntries.filter(([, w]) => !w.post.responses["200"])) {
    const body = post.requestBody.content["application/json"].schema;
    const data = ((body.properties as Record<string, Schema> | undefined) ?? {}).data ?? body;
    const id = `event-${name.replace(/\./g, "-")}`;
    sections.push({
      kind: "event",
      id,
      title: name,
      group: "Webhooks",
      badge: "EVENT",
      description: post.description,
      fields: fieldsOf(data, components),
      example: json(exampleFor(body, components)),
      answers: [],
    });
    webhookItems.push({ id, href: "", label: name, badge: "EVENT" });
  }
  const hooksProse = proseById.get("decision-hooks");
  if (hooksProse) {
    sections.push({ kind: "prose", id: hooksProse.id, title: hooksProse.title, group: "Webhooks", body: hooksProse.body });
    webhookItems.push({ id: hooksProse.id, href: "", label: "Decision hooks" });
  }
  for (const [name, { post }] of hookEntries.filter(([, w]) => w.post.responses["200"])) {
    const body = post.requestBody.content["application/json"].schema;
    const answer = post.responses["200"]?.content?.["application/json"]?.schema ?? {};
    const variants = ((resolve(answer, components).anyOf as Schema[] | undefined) ?? [answer]);
    const id = `hook-${name.replace(/\./g, "-")}`;
    sections.push({
      kind: "event",
      id,
      title: name,
      group: "Webhooks",
      badge: "HOOK",
      description: post.description,
      fields: fieldsOf(body, components),
      example: json(exampleFor(body, components)),
      answers: variants.map((v, i) => ({
        label: i === 0 ? "Allow" : "Refuse",
        fields: fieldsOf(v, components),
        example: json(exampleFor(v, components)),
      })),
    });
    webhookItems.push({ id, href: "", label: name, badge: "HOOK" });
  }
  nav.push({ title: "Webhooks", items: webhookItems });

  // Resources, in the order a reader meets them.
  const resourceItems: NavItem[] = [];
  for (const name of ["Plan", "Location", "Voucher", "Payment", "Customer"]) {
    const schema = components[name];
    if (!schema) continue;
    const id = `resource-${name.toLowerCase()}`;
    sections.push({
      kind: "resource",
      id,
      title: name,
      group: "Resources",
      description: typeof schema.description === "string" ? schema.description : "",
      fields: fieldsOf(schema, components),
      example: json(exampleFor(schema, components)),
    });
    resourceItems.push({ id, href: "", label: name });
  }
  nav.push({ title: "Resources", items: resourceItems });

  const placed: DocsSection[] = sections.map((s) => ({ ...s, href: hrefFor(s) }));
  const hrefOf = new Map(placed.map((s) => [s.id, s.href]));
  for (const item of [...nav.flatMap((g) => g.items), ...endpoints]) item.href = hrefOf.get(item.id) ?? "/developers";

  const search: SearchEntry[] = placed.map((s) => ({
    id: s.id,
    href: s.href,
    title: s.title,
    group: s.group,
    badge: s.kind === "endpoint" ? s.method : s.kind === "event" ? s.badge : undefined,
    text: [
      s.title,
      s.group,
      s.kind === "prose" ? s.body : "",
      s.kind === "endpoint" ? `${s.path} ${s.description} ${s.scope} ${s.params.map((p) => p.name).join(" ")} ${s.response.fields.map((f) => f.name).join(" ")}` : "",
      s.kind === "event" || s.kind === "resource" ? `${s.description} ${s.fields.map((f) => f.name).join(" ")}` : "",
      s.kind === "introduction" ? "base url overview getting started" : "",
    ]
      .join(" ")
      .toLowerCase(),
  }));

  const voucherGet = sections.find((s) => s.kind === "endpoint" && s.path === "/vouchers/{id}");
  return {
    baseUrl,
    sections: placed,
    nav,
    search,
    endpoints,
    exampleResponse: voucherGet && voucherGet.kind === "endpoint" ? voucherGet.example : "{}",
  };
}

/* ------------------------------------------------ helpers */

interface Operation {
  summary: string;
  description: string;
  tags?: string[];
  "x-required-scope": string;
  parameters: { name: string; in: string; required: boolean; description?: string; schema: Schema }[];
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

interface WebhookOp {
  description: string;
  requestBody: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

function resolve(schema: Schema, components: Record<string, Schema>): Schema {
  const ref = schema.$ref;
  return typeof ref === "string" ? (components[ref.split("/").pop()!] ?? schema) : schema;
}

function refName(schema: Schema): string | null {
  return typeof schema.$ref === "string" ? schema.$ref.split("/").pop()! : null;
}

function fieldsOf(schema: Schema, components: Record<string, Schema>): Field[] {
  const resolved = resolve(schema, components);
  const props = (resolved.properties as Record<string, Schema> | undefined) ?? {};
  const required = new Set((resolved.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, s]) => fieldOf(name, s, components, required.has(name)));
}

function fieldOf(name: string, schema: Schema, components: Record<string, Schema>, required: boolean): Field {
  const types = Array.isArray(schema.type) ? (schema.type as string[]) : [];
  const variants = (schema.anyOf as Schema[] | undefined) ?? [];
  const nullable = types.includes("null") || variants.some((v) => v.type === "null");
  const example = exampleFor(schema, components);
  return {
    name,
    type: typeLabel(schema, components),
    required,
    nullable,
    description: typeof schema.description === "string" ? schema.description : null,
    example: example === undefined || (typeof example === "object" && example !== null) ? null : JSON.stringify(example),
  };
}

/** "string", "integer, 1 to 50", "list of Voucher", "one of active, expired". */
export function typeLabel(schema: Schema, components: Record<string, Schema>): string {
  const name = refName(schema);
  if (name) return name;
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map(String).join(", ")}`;
  const variants = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (Array.isArray(variants)) {
    return variants
      .filter((v) => v.type !== "null")
      .map((v) => typeLabel(v, components))
      .join(" or ");
  }
  const types = (Array.isArray(schema.type) ? (schema.type as string[]) : schema.type ? [schema.type as string] : []).filter(
    (t) => t !== "null"
  );
  let label = types.join(" or ") || "any";
  if (types[0] === "array" && schema.items) label = `list of ${typeLabel(schema.items as Schema, components)}`;
  if (types[0] === "object" && !schema.properties) label = "object";
  // Zod gives every integer JavaScript's safe-integer bounds; only a real
  // range (like limit's 1 to 50) is worth showing.
  const real = (n: unknown) => typeof n === "number" && Math.abs(n) < Number.MAX_SAFE_INTEGER;
  const range = real(schema.minimum) && real(schema.maximum) ? `, ${schema.minimum} to ${schema.maximum}` : "";
  const fallback = "default" in schema ? `, default ${JSON.stringify(schema.default)}` : "";
  return `${label}${range}${fallback}`;
}

/** The error responses' descriptions are "`code`: meaning; `code`: meaning". */
function parseCodes(description: string): { code: string; meaning: string }[] {
  return description
    .split("; ")
    .map((part) => {
      const m = /^`([^`]+)`: (.*)$/.exec(part);
      return m ? { code: m[1], meaning: m[2] } : null;
    })
    .filter((x): x is { code: string; meaning: string } => x !== null);
}

function samples(baseUrl: string, method: string, path: string, tag: string, list: boolean): CodeSample[] {
  const noun = tag.replace(/s$/, "").toUpperCase();
  const concrete = path.replace(/\{([^}]+)\}/g, (_m, p: string) => `$${noun}_${p.toUpperCase()}`);
  const jsPath = path.replace(/\{([^}]+)\}/g, (_m, p: string) => `\${${noun.toLowerCase()}${titleCase(p)}}`);
  const query = list ? "?limit=25" : "";
  const curlMethod = method === "GET" ? "" : ` -X ${method}`;
  const usesTemplate = jsPath.includes("${");
  const quote = usesTemplate ? "`" : '"';
  return [
    {
      label: "curl",
      language: "shell",
      code: `curl${curlMethod} "${baseUrl}${concrete}${query}" \\\n  -H "Authorization: Bearer $OGAWIFI_API_KEY"`,
    },
    {
      label: "JavaScript",
      language: "js",
      code: [
        `const res = await fetch(${quote}${baseUrl}${jsPath}${query}${quote}, {`,
        method === "GET" ? null : `  method: "${method}",`,
        "  headers: { Authorization: `Bearer ${process.env.OGAWIFI_API_KEY}` },",
        "});",
        list ? "const { data, nextCursor } = await res.json();" : "const { data } = await res.json();",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
