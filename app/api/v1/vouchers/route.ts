/**
 * GET /api/v1/vouchers?status=&from=&to=&limit=&cursor= : newest first,
 * paged by cursor. Scope vouchers:read. Uses the same query, and therefore
 * the same indexes, as the owner's Vouchers page (lib/vouchers-list.ts).
 */

import { queryVouchers } from "@/lib/vouchers-list";
import { cursorParam, dateParam, enumParam, listMaxReads, pageSize, publicApi } from "@/lib/public-api";
import { publicVoucher } from "@/lib/public-api-serializers";

const STATUSES = ["active", "expired", "failed", "superseded"] as const;

export const GET = publicApi(
  "vouchers:read",
  async ({ tenantId, url }) => {
    const limit = pageSize(url);
    const page = await queryVouchers({
      tenantId,
      filters: { status: enumParam(url, "status", STATUSES), from: dateParam(url, "from"), to: dateParam(url, "to") },
      cursor: cursorParam(url),
      pageSize: limit,
    });
    return {
      data: page.vouchers.map(publicVoucher),
      nextCursor: page.nextCursor,
      reads: Math.max(1, page.vouchers.length + (page.nextCursor ? 1 : 0)),
    };
  },
  listMaxReads
);
