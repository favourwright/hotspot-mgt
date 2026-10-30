import { z } from "zod";
import { queryVouchers } from "@/lib/vouchers-list";
import { dateQuery, listQuery, parseDate, publicApi } from "@/lib/public-api";
import { publicVoucher } from "@/lib/public-api-serializers";
import { PublicVoucherSchema } from "@/lib/api-schemas";

// Same query, and so the same indexes, as the owner's Vouchers page.
export const GET = publicApi(
  {
    scope: "vouchers:read",
    summary: "List vouchers",
    description: "Newest first, paged by cursor.",
    list: true,
    query: z.object({
      ...listQuery,
      status: PublicVoucherSchema.shape.status.optional().describe("Only vouchers in this state"),
      from: dateQuery("Created on or after"),
      to: dateQuery("Created on or before"),
    }),
    response: z.array(PublicVoucherSchema),
  },
  async ({ tenantId, query }) => {
    const page = await queryVouchers({
      tenantId,
      filters: { status: query.status ?? null, from: parseDate(query.from), to: parseDate(query.to) },
      cursor: query.cursor ?? null,
      pageSize: query.limit,
    });
    return {
      data: page.vouchers.map(publicVoucher),
      nextCursor: page.nextCursor,
      reads: Math.max(1, page.vouchers.length + (page.nextCursor ? 1 : 0)),
    };
  }
);
