import { z } from "zod";
import { queryTransactions } from "@/lib/transactions";
import { dateQuery, listQuery, parseDate, publicApi } from "@/lib/public-api";
import { publicPayment } from "@/lib/public-api-serializers";
import { PublicPaymentSchema } from "@/lib/api-schemas";

// Same query, and so the same indexes, as the owner's Transactions page.
export const GET = publicApi(
  {
    scope: "payments:read",
    summary: "List payments",
    description: "Newest first, paged by cursor.",
    list: true,
    query: z.object({
      ...listQuery,
      status: PublicPaymentSchema.shape.status.optional().describe("Only payments in this state"),
      from: dateQuery("Paid on or after"),
      to: dateQuery("Paid on or before"),
    }),
    response: z.array(PublicPaymentSchema),
  },
  async ({ tenantId, query }) => {
    const page = await queryTransactions({
      tenantId,
      filters: { status: query.status ?? null, from: parseDate(query.from), to: parseDate(query.to) },
      cursor: query.cursor ?? null,
      pageSize: query.limit,
    });
    return {
      data: page.payments.map(publicPayment),
      nextCursor: page.nextCursor,
      reads: Math.max(1, page.payments.length + (page.nextCursor ? 1 : 0)),
    };
  }
);
