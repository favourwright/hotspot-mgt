/**
 * GET /api/v1/openapi.json: the API's OpenAPI 3.1 document, built from the
 * code itself (lib/openapi.ts), so it is never out of date. Public, like any
 * API reference: it describes shapes, not anybody's data.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/openapi";
import { requestOrigin } from "@/lib/request-origin";

export function GET(request: NextRequest) {
  return NextResponse.json(buildOpenApiDocument(requestOrigin(request)), {
    headers: {
      // Short: a deploy changes it, and a stale copy would be a lie.
      "cache-control": "public, max-age=300",
      // Readable from tools on other origins (Swagger UI, Postman, code
      // generators). It is public documentation; there is nothing to steal.
      "access-control-allow-origin": "*",
    },
  });
}
