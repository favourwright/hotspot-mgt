/**
 * The OpenAPI 3.1 document, built from the code on every request. Nothing
 * here describes the API; it only collects what the code already states:
 *
 *  - paths from lib/generated/api-routes.ts, which is generated from where
 *    the route files are;
 *  - each operation from its route's `publicApi({...})` declaration: scope,
 *    summary, the query schema that validates it, the response schema its
 *    data is checked against;
 *  - resources from lib/api-schemas.ts, which the serializers are tested
 *    against field for field;
 *  - webhooks from lib/webhook-events.ts and the decision-hook schemas in
 *    lib/decision-hook-contract.ts, which the real payloads are tested
 *    against;
 *  - the prose from lib/api-docs-content.ts, which reads the same constants
 *    the code enforces.
 *
 * Served at /api/v1/openapi.json and rendered at /developers.
 */

import { z } from "zod";
import { API_ROUTES } from "@/lib/generated/api-routes";
import { ERROR_CATALOG, TYPES, type EndpointSpec } from "@/lib/public-api";
import { WEBHOOK_API_VERSION, WEBHOOK_EVENTS, WEBHOOK_EVENT_TYPES } from "@/lib/webhook-events";
import {
  DecisionHookRequestSchema,
  DecisionHookResponseSchema,
  HOOK_EVENT,
} from "@/lib/decision-hook-contract";
import { docMarkdown } from "@/lib/api-docs-content";

type JsonSchema = Record<string, unknown>;
type Doc = Record<string, unknown>;

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const ErrorBodySchema = z
  .object({
    error: z.object({
      type: z.enum(Object.values(TYPES) as [string, ...string[]]),
      code: z.enum(Object.keys(ERROR_CATALOG) as [string, ...string[]]),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .meta({ id: "Error", description: "Every error, whatever the status" });

/**
 * Status codes every operation can answer with besides 200: 400 because an
 * unknown parameter is refused everywhere, and 404 where a path names a
 * record.
 */
function errorStatuses(hasPathParams: boolean): number[] {
  return [400, 401, 402, 403, ...(hasPathParams ? [404] : []), 429, 500];
}

export function buildOpenApiDocument(origin: string): Doc {
  const components: Record<string, JsonSchema> = {};

  /**
   * Zod's JSON Schema, with named schemas (those with a `meta` id) lifted
   * into components and referenced, so each resource is described once.
   */
  const schemaOf = (schema: z.ZodType, io: "input" | "output" = "output"): JsonSchema => {
    const raw = z.toJSONSchema(schema, { io, target: "draft-2020-12", unrepresentable: "any" }) as JsonSchema;
    const defs = (raw.$defs as Record<string, JsonSchema> | undefined) ?? {};
    for (const [id, def] of Object.entries(defs)) components[id] ??= rewriteRefs(def) as JsonSchema;
    const { $defs: _d, $schema: _s, id, ...rest } = raw;
    void _d;
    void _s;
    const body = rewriteRefs(rest) as JsonSchema;
    // A top-level named schema becomes a component and a reference to it.
    if (typeof id === "string") {
      components[id] ??= body;
      return { $ref: `#/components/schemas/${id}` };
    }
    return body;
  };

  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of API_ROUTES) {
    const pathParams = [...route.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const method of METHODS) {
      const handler = (route.module as Record<string, unknown>)[method] as { apiSpec?: EndpointSpec } | undefined;
      const spec = handler?.apiSpec;
      if (!spec) continue;

      const query = spec.query ? schemaOf(spec.query, "input") : null;
      const queryProps = (query?.properties as Record<string, JsonSchema> | undefined) ?? {};
      const required = new Set((query?.required as string[] | undefined) ?? []);

      const envelope = z.object({
        data: spec.response,
        ...(spec.list ? { nextCursor: z.string().nullable().describe("Pass as `cursor` for the next page; null on the last") } : {}),
      });

      paths[route.path] ??= {};
      paths[route.path][method.toLowerCase()] = {
        operationId: operationId(method, route.path),
        summary: spec.summary,
        description: [spec.description, `Needs the \`${spec.scope}\` permission.`].filter(Boolean).join("\n\n"),
        tags: [route.path.split("/")[1]],
        security: [{ apiKey: [] }],
        "x-required-scope": spec.scope,
        parameters: [
          ...pathParams.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
          ...Object.entries(queryProps).map(([name, schema]) => ({
            name,
            in: "query",
            required: required.has(name) && !("default" in schema),
            description: schema.description,
            schema: withoutDescription(schema),
          })),
        ],
        responses: {
          200: {
            description: "Success",
            headers: { "x-read-budget-remaining": { schema: { type: "integer" }, description: "Records left in today's read budget" } },
            content: { "application/json": { schema: schemaOf(envelope) } },
          },
          ...Object.fromEntries(
            errorStatuses(pathParams.length > 0).map((status) => [status, { $ref: `#/components/responses/E${status}` }])
          ),
        },
      };
    }
  }

  const errorRef = schemaOf(ErrorBodySchema);
  const errorResponses = Object.fromEntries(
    [...new Set(Object.values(ERROR_CATALOG).map((e) => e.status))].sort().map((status) => [
      `E${status}`,
      {
        description: Object.entries(ERROR_CATALOG)
          .filter(([, e]) => e.status === status)
          .map(([code, e]) => `\`${code}\`: ${e.meaning}`)
          .join("; "),
        content: { "application/json": { schema: errorRef } },
      },
    ])
  );

  const webhooks: Record<string, unknown> = {};
  for (const type of WEBHOOK_EVENT_TYPES) {
    const def = WEBHOOK_EVENTS[type];
    webhooks[type] = {
      post: {
        summary: type,
        description: def.description,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaOf(
                z.object({
                  apiVersion: z.literal(WEBHOOK_API_VERSION),
                  id: z.string().describe("The same for every delivery of this fact; deduplicate on it"),
                  type: z.literal(type),
                  createdAt: z.string().describe("ISO 8601 time, UTC"),
                  data: def.data,
                })
              ),
            },
          },
        },
        responses: { "2XX": { description: "Accepted. Anything else is retried." } },
      },
    };
  }
  webhooks[HOOK_EVENT] = {
    post: {
      summary: `${HOOK_EVENT} (decision hook)`,
      description:
        "Not an event: a question. Sent to your decision hook before a customer pays; your answer decides whether they may. See Decision hooks above.",
      requestBody: { required: true, content: { "application/json": { schema: schemaOf(DecisionHookRequestSchema) } } },
      responses: {
        200: { description: "Your decision", content: { "application/json": { schema: schemaOf(DecisionHookResponseSchema) } } },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "OgaWiFi API",
      version: "v1",
      description: docMarkdown(),
    },
    servers: [{ url: `${origin.replace(/\/$/, "")}/api/v1` }],
    tags: [...new Set(API_ROUTES.map((r) => r.path.split("/")[1]))].map((name) => ({ name })),
    paths,
    webhooks,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "`Authorization: Bearer ogw_live_...`" },
      },
      responses: errorResponses,
      schemas: components,
    },
  };
}

function operationId(method: string, path: string): string {
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((p) => (p.startsWith("{") ? `By${cap(p.slice(1, -1))}` : cap(p)));
  return method.toLowerCase() + parts.join("");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function withoutDescription(schema: JsonSchema): JsonSchema {
  const { description: _d, ...rest } = schema;
  void _d;
  return rest;
}

/** Zod points nested names at `#/$defs/X`; OpenAPI keeps them in components. */
function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        k === "$ref" && typeof v === "string" && v.startsWith("#/$defs/")
          ? `#/components/schemas/${v.slice("#/$defs/".length)}`
          : rewriteRefs(v);
    }
    return out;
  }
  return value;
}
