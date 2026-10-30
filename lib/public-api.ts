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
  parseApiKey,
  recordKeyUse,
  secretMatches,
  type ApiKeyRecord,
  type ApiScope,
} from "@/lib/api-keys";
import { hasApiAccess } from "@/lib/api-access";
import { rateLimit } from "@/lib/rate-limit";

export const API_VERSION = "v1";

/** Per tenant, per UTC day, in Firestore documents read. */
export const DAILY_READ_BUDGET = 5000;
export const PER_KEY_LIMIT = { max: 60, windowMs: 60_000 };
export const PER_TENANT_LIMIT = { max: 120, windowMs: 60_000 };
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

const TYPES: Record<number, string> = {
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

export interface ApiResult {
  data: unknown;
  /** Present on lists; null on the last page. */
  nextCursor?: string | null;
  /** Firestore documents this request read, charged to the budget. */
  reads: number;
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

/* ------------------------------------------------ the wrapper */

export function publicApi<P = Record<string, never>>(
  scope: ApiScope,
  handler: (ctx: ApiContext, params: P) => Promise<ApiResult>,
  /** The most documents one call can read, checked against the budget first. */
  maxReads: (url: URL) => number = () => 1
) {
  return async (request: NextRequest, segment: { params: Promise<P> }) => {
    const requestId = `req_${randomBytes(8).toString("hex")}`;
    const headers: Record<string, string> = {
      "x-request-id": requestId,
      "cache-control": "no-store",
    };

    try {
      const record = await authenticateRequest(request.headers.get("authorization"), scope);

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
      const now = Date.now();
      const remaining = budgetRemaining(record.tenantId, now);
      headers["x-read-budget-remaining"] = String(Math.max(0, remaining));
      if (remaining < maxReads(url)) {
        headers["retry-after"] = String(secondsToUtcMidnight(now));
        throw new ApiError(
          429,
          "daily_budget_exhausted",
          "This business's daily API read budget is used up. It resets at 00:00 UTC."
        );
      }

      const result = await handler(
        { tenantId: record.tenantId, keyId: record.keyId, requestId, url },
        await segment.params
      );

      chargeBudget(record.tenantId, result.reads, now);
      headers["x-read-budget-remaining"] = String(Math.max(0, remaining - result.reads));
      recordKeyUse(record.keyId, (task) =>
        after(() => task().catch((e) => console.error("[api] usage flush failed:", e)))
      );

      const body =
        result.nextCursor === undefined
          ? { data: result.data }
          : { data: result.data, nextCursor: result.nextCursor };
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
}

/* ------------------------------------------------ query parameters */

export function pageSize(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) {
    throw new ApiError(400, "invalid_limit", `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return n;
}

/** Lists read one more document than they return, to know if there is more. */
export function listMaxReads(url: URL): number {
  try {
    return pageSize(url) + 1;
  } catch {
    return 1;
  }
}

export function cursorParam(url: URL): string | null {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw === "") return null;
  if (raw.length > 200 || !/^\d+_[A-Za-z0-9_-]+$/.test(raw)) {
    throw new ApiError(400, "invalid_cursor", "cursor is not one this API returned.");
  }
  return raw;
}

export function enumParam<T extends string>(url: URL, name: string, allowed: readonly T[]): T | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ApiError(400, `invalid_${name}`, `${name} must be one of: ${allowed.join(", ")}.`);
  }
  return raw as T;
}

export function dateParam(url: URL, name: string): Date | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(400, `invalid_${name}`, `${name} must be an ISO 8601 date or time.`);
  }
  return d;
}

export function notFound(what: string): never {
  throw new ApiError(404, "not_found", `No such ${what}.`);
}
