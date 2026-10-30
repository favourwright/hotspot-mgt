/**
 * GET /api/v1/payments?status=&from=&to=&limit=&cursor= : newest first,
 * paged by cursor. Scope payments:read. Same query and indexes as the
 * owner's Transactions page (lib/transactions.ts).
 */

import { queryTransactions } from "@/lib/transactions";
import { cursorParam, dateParam, enumParam, listMaxReads, pageSize, publicApi } from "@/lib/public-api";
import { publicPayment } from "@/lib/public-api-serializers";

const STATUSES = ["pending", "success", "failed"] as const;

export const GET = publicApi(
  "payments:read",
  async ({ tenantId, url }) => {
    const limit = pageSize(url);
    const page = await queryTransactions({
      tenantId,
      filters: { status: enumParam(url, "status", STATUSES), from: dateParam(url, "from"), to: dateParam(url, "to") },
      cursor: cursorParam(url),
      pageSize: limit,
    });
    return {
      data: page.payments.map(publicPayment),
      nextCursor: page.nextCursor,
      reads: Math.max(1, page.payments.length + (page.nextCursor ? 1 : 0)),
    };
  },
  listMaxReads
);
