/**
 * The one wrapper every /api/v1 route runs through, so a route contains only
 * its query and nothing about authentication, limits or response shape.
 *
 * In order: request id, API key (one uniform 401 whatever is wrong with it),
 * the API Access addon (402, checked on every request: unlike a hook, an API
 * whose entitlement lapsed should simply stop), scope (403), rate limits and
 * the daily read budget (429), then the handler, then the envelope:
 *
 *   200  { "data": ..., "nextCursor": "..." | null }
 *   4xx  { "error": { "type", "code", "message", "requestId" } }
 *
 * frozen for v1. Additive changes only; a breaking change is v2.
 *
 * ## The read budget, and why it exists
 *
 * The project is on Firestore's Spark plan, where the whole app shares a
 * daily read quota, and running out takes every page down at once
 * (`8 RESOURCE_EXHAUSTED`, docs/decisions-and-gotchas.md). A public API
 * hands that quota to tenants' scripts. So each tenant gets a daily budget
 * of document reads, counted as actually spent, and a request that could
 * overrun it is refused before it runs. Raise DAILY_READ_BUDGET on Blaze.
 *
 * Limits and the budget live in process memory (one long-lived process),
 * keyed only by ids from a verified key, and reset on restart.
 */

import { randomBytes } from "node:crypto";
import { after, type NextRequest } from "next/server";
import {
  getApiKey,
  KeyLookupThrottledError,
  parseApiKey,
  recordKeyUse,
  secretMatches,
  type ApiKeyRecord,
  type ApiScope,
} from "@/lib/api-keys";
import { hasApiAccess } from "@/lib/api-access";
import { isRateLimited, rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { z } from "zod";

export const API_VERSION = "v1";

/** Per tenant, per UTC day, in Firestore documents read. */
export const DAILY_READ_BUDGET = 5000;
export const PER_KEY_LIMIT = { max: 60, windowMs: 60_000 };
export const PER_TENANT_LIMIT = { max: 120, windowMs: 60_000 };
/** Failed authentications per client address, before lookups are refused. */
export const AUTH_FAILURE_LIMIT = { max: 20, windowMs: 10 * 60_000 };
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Every error code the API can answer with, and what it means. The docs'
 * error table is generated from this, and `npm run test:api-docs` fails if
 * the code throws a code that is not here.
 */
export const ERROR_CATALOG: Record<string, { status: number; meaning: string }> = {
  unknown_parameter: { status: 400, meaning: "A query parameter this endpoint does not take; usually a typo" },
  invalid_limit: { status: 400, meaning: "`limit` is not a whole number in range" },
  invalid_cursor: { status: 400, meaning: "`cursor` is not one this API returned" },
  invalid_status: { status: 400, meaning: "`status` is not one of the listed values" },
  invalid_from: { status: 400, meaning: "`from` is not an ISO 8601 date or time" },
  invalid_to: { status: 400, meaning: "`to` is not an ISO 8601 date or time" },
  invalid_locationId: { status: 400, meaning: "`locationId` is not a valid id" },
  invalid_api_key: { status: 401, meaning: "Missing, malformed, unknown, revoked or wrong. Deliberately one answer for all of them" },
  api_access_required: { status: 402, meaning: "The business's API Access addon is not active" },
  insufficient_scope: { status: 403, meaning: "The key does not have the permission this endpoint needs" },
  not_found: { status: 404, meaning: "No such record at this business" },
  rate_limited: { status: 429, meaning: "Too many requests; wait `retry-after` seconds" },
  daily_budget_exhausted: { status: 429, meaning: "Today's read budget is spent; it resets at 00:00 UTC" },
  internal_error: { status: 500, meaning: "Ours. Retry later, and quote the requestId if it persists" },
};

export const TYPES: Record<number, string> = {
  400: "invalid_request",
  401: "authentication_error",
  402: "payment_required",
  403: "permission_error",
  404: "not_found",
  429: "rate_limit_error",
  500: "api_error",
};

export interface ApiContext {
  tenantId: string;
  keyId: string;
  requestId: string;
  url: URL;
}


/* ------------------------------------------------ the daily budget */

let budgetDay = "";
const budgetUsed = new Map<string, number>();

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function budgetRemaining(tenantId: string, now = Date.now()): number {
  if (today(now) !== budgetDay) {
    budgetDay = today(now);
    budgetUsed.clear();
  }
  return DAILY_READ_BUDGET - (budgetUsed.get(tenantId) ?? 0);
}

export function chargeBudget(tenantId: string, reads: number, now = Date.now()): void {
  budgetRemaining(tenantId, now);
  budgetUsed.set(tenantId, (budgetUsed.get(tenantId) ?? 0) + reads);
}

function secondsToUtcMidnight(now: number): number {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.ceil((midnight - now) / 1000);
}

/* ------------------------------------------------ authentication */

export interface AuthDeps {
  getKey: (keyId: string) => Promise<ApiKeyRecord | null>;
  hasAccess: (tenantId: string) => Promise<boolean>;
}

const productionAuth: AuthDeps = { getKey: getApiKey, hasAccess: hasApiAccess };

/**
 * The key, or the error to answer with. Lookups are injectable so the
 * tests can cover every branch without Firestore.
 */
export async function authenticateRequest(
  authHeader: string | null,
  scope: ApiScope,
  deps: AuthDeps = productionAuth
): Promise<ApiKeyRecord> {
  const auth = authHeader ?? "";
  const parsed = auth.startsWith("Bearer ") ? parseApiKey(auth.slice(7).trim()) : null;
  // One answer for every way a key can be wrong (missing, malformed,
  // unknown, revoked, bad secret), so probing teaches nothing.
  const record = parsed ? await deps.getKey(parsed.keyId) : null;
  if (
    !parsed ||
    !record ||
    record.revokedAt ||
    record.environment !== parsed.environment ||
    !secretMatches(parsed.secret, record.secretHash)
  ) {
    throw new ApiError(401, "invalid_api_key", "Missing or invalid API key.");
  }

  if (!(await deps.hasAccess(record.tenantId))) {
    throw new ApiError(402, "api_access_required", "This business's API Access addon is not active.");
  }
  if (!record.scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", `This key does not have the ${scope} scope.`);
  }
  return record;
}

/* ------------------------------------------------ declaring an endpoint */

/**
 * Everything the docs say about an endpoint, stated once, in the route file,
 * in the form that also runs it. The path is not here: it is the file's
 * location under app/api/v1 (scripts/generate-api-index.mts).
 */
export interface EndpointSpec<Q extends z.ZodObject = z.ZodObject, R extends z.ZodType = z.ZodType> {
  scope: ApiScope;
  /** One line, for people. The only prose an endpoint needs. */
  summary: string;
  description?: string;
  /** Parsed strictly: an unknown parameter is a 400, not silently ignored. */
  query?: Q;
  /** The shape of `data`. */
  response: R;
  /** Paged: the envelope adds `nextCursor`. */
  list?: boolean;
  /** The most documents one call can read, checked against the budget first. */
  maxReads?: (query: z.output<Q>) => number;
}

export interface HandlerResult<R extends z.ZodType> {
  data: z.input<R>;
  /** Lists only; null on the last page. */
  nextCursor?: string | null;
  /** Firestore documents this request read, charged to the budget. */
  reads: number;
}

/** A route handler that also carries its own description. */
export type DocumentedHandler = ((
  request: NextRequest,
  segment: { params: Promise<Record<string, string>> }
) => Promise<Response>) & { apiSpec: EndpointSpec };

/* ------------------------------------------------ shared parameters */

const CURSOR_PATTERN = /^\d+_[A-Za-z0-9_-]+$/;

/** `limit` and `cursor`, the same on every list. */
export const listQuery = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Results per page, 1 to ${MAX_PAGE_SIZE}`),
  cursor: z
    .string()
    .max(200)
    .regex(CURSOR_PATTERN, "cursor is not one this API returned")
    .optional()
    .meta({ description: "The `nextCursor` from the previous page", examples: ["1761818400000_vch_Zx81kQ0pLm"] }),
};

/** An ISO 8601 date or time, as a query parameter. */
export function dateQuery(what: string) {
  return z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), `${what} must be an ISO 8601 date or time`)
    .optional()
    .meta({ description: `${what}: an ISO 8601 date or time, inclusive`, examples: ["2026-10-01"] });
}

export function parseDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

/** A list reads one more document than it returns, to know if there is more. */
const listReads = (q: { limit?: number }) => (q.limit ?? DEFAULT_PAGE_SIZE) + 1;

/* ------------------------------------------------ the wrapper */

export function publicApi<
  Q extends z.ZodObject = z.ZodObject<Record<string, never>>,
  R extends z.ZodType = z.ZodType,
  P = Record<string, never>,
>(
  spec: EndpointSpec<Q, R>,
  handler: (ctx: ApiContext & { query: z.output<Q> }, params: P) => Promise<HandlerResult<R>>
) {
  const run = async (request: NextRequest, segment: { params: Promise<P> }) => {
    const requestId = `req_${randomBytes(8).toString("hex")}`;
    const headers: Record<string, string> = {
      "x-request-id": requestId,
      "cache-control": "no-store",
    };

    // Failed authentications per address, checked before the key lookup
    // (which reads Firestore) and counted only when one fails, so a working
    // integration never notices it. See also the miss budget in lib/api-keys.ts.
    const failKey = `api:authfail:${clientIp(request.headers)}`;
    try {
      if (isRateLimited(failKey, AUTH_FAILURE_LIMIT)) {
        headers["retry-after"] = String(Math.ceil(AUTH_FAILURE_LIMIT.windowMs / 1000));
        throw new ApiError(429, "rate_limited", "Too many requests. Slow down and retry.");
      }
      let record: ApiKeyRecord;
      try {
        record = await authenticateRequest(request.headers.get("authorization"), spec.scope);
      } catch (error) {
        if (error instanceof KeyLookupThrottledError) {
          headers["retry-after"] = "60";
          throw new ApiError(429, "rate_limited", "Too many requests. Slow down and retry.");
        }
        if (error instanceof ApiError && error.status === 401) rateLimit(failKey, AUTH_FAILURE_LIMIT);
        throw error;
      }

      const keyLimit = rateLimit(`api:key:${record.keyId}`, PER_KEY_LIMIT);
      const tenantLimit = rateLimit(`api:tenant:${record.tenantId}`, PER_TENANT_LIMIT);
      headers["ratelimit-limit"] = String(PER_KEY_LIMIT.max);
      if (!keyLimit.ok || !tenantLimit.ok) {
        const retry = Math.ceil(Math.max(keyLimit.retryAfterMs, tenantLimit.retryAfterMs) / 1000);
        headers["retry-after"] = String(retry);
        headers["ratelimit-remaining"] = "0";
        headers["ratelimit-reset"] = String(retry);
        throw new ApiError(429, "rate_limited", "Too many requests. Slow down and retry.");
      }

      const url = new URL(request.url);
      const query = parseQuery(spec.query, url) as z.output<Q>;

      const now = Date.now();
      const remaining = budgetRemaining(record.tenantId, now);
      headers["x-read-budget-remaining"] = String(Math.max(0, remaining));
      const maxReads = spec.maxReads ?? (spec.list ? listReads : () => 2);
      if (remaining < maxReads(query as never)) {
        headers["retry-after"] = String(secondsToUtcMidnight(now));
        throw new ApiError(
          429,
          "daily_budget_exhausted",
          "This business's daily API read budget is used up. It resets at 00:00 UTC."
        );
      }

      const result = await handler(
        { tenantId: record.tenantId, keyId: record.keyId, requestId, url, query },
        await segment.params
      );

      // Outside production, check the data against the schema the docs are
      // generated from, so a drift shows up in development rather than in a
      // tenant's integration. Logged, never thrown at a caller.
      if (process.env.NODE_ENV !== "production") {
        const check = spec.response.safeParse(result.data);
        if (!check.success) {
          console.error(`[api] ${request.method} ${url.pathname} returned data its schema does not describe:`, check.error.issues);
        }
      }

      chargeBudget(record.tenantId, result.reads, now);
      headers["x-read-budget-remaining"] = String(Math.max(0, remaining - result.reads));
      recordKeyUse(record.keyId, (task) =>
        after(() => task().catch((e) => console.error("[api] usage flush failed:", e)))
      );

      const body = spec.list
        ? { data: result.data, nextCursor: result.nextCursor ?? null }
        : { data: result.data };
      return Response.json(body, { status: 200, headers });
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(500, "internal_error", "Something went wrong on our side.");
      if (!(error instanceof ApiError)) console.error(`[api] ${requestId}:`, error);
      return Response.json(
        {
          error: {
            type: TYPES[apiError.status] ?? "api_error",
            code: apiError.code,
            message: apiError.message,
            requestId,
          },
        },
        { status: apiError.status, headers }
      );
    }
  };
  return Object.assign(run, { apiSpec: spec as unknown as EndpointSpec });
}

/**
 * The query string, through the endpoint's own schema. Strict, so a typo
 * (`limt=10`) is a 400 naming the parameter instead of a silently ignored
 * one; the code names the first offending parameter, as `invalid_<name>`.
 */
export function parseQuery(schema: z.ZodObject | undefined, url: URL): unknown {
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = (schema ?? z.object({})).strict().safeParse(raw);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  if (issue.code === "unrecognized_keys") {
    const name = (issue as { keys?: string[] }).keys?.[0] ?? "parameter";
    throw new ApiError(400, "unknown_parameter", `${name} is not a parameter of this endpoint.`);
  }
  const name = String(issue.path[0] ?? "request");
  throw new ApiError(400, `invalid_${name}`, `${name}: ${issue.message}`);
}

export function notFound(what: string): never {
  throw new ApiError(404, "not_found", `No such ${what}.`);
}
