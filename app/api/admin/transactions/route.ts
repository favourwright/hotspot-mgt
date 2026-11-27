/**
 * Pages and totals for the transactions list.
 *
 * The page server-renders its first page, so this exists for everything
 * after that: turning a page, changing a filter, or running a lookup. Same
 * arrangement as the rest of `/api/admin/*` - `verifyTenantAccessBySlug`,
 * so an owner is scoped to their own tenant and a superadmin must name one.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyTenantAccessBySlug,
  handleAuthError,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import {
  getTransactionTotals,
  lookupTransactions,
  queryTransactions,
  TRANSACTIONS_PAGE_SIZE,
} from "@/lib/transactions";
import { z } from "zod";
import { endOfDisplayZoneDate, startOfDisplayZoneDate } from "@/lib/utils";

const paramsSchema = z.object({
  status: z.enum(["success", "pending", "failed"]).nullable().default(null),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
  cursor: z.string().nullable().default(null),
  /** An exact reference or email. Answered by its own query, not a filter. */
  lookup: z.string().nullable().default(null),
});

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyTenantAccessBySlug(
      request.headers.get("authorization"),
      request.headers.get(TENANT_SLUG_HEADER)
    );

    const url = request.nextUrl.searchParams;
    const parsed = paramsSchema.safeParse({
      status: url.get("status"),
      from: url.get("from"),
      to: url.get("to"),
      cursor: url.get("cursor"),
      lookup: url.get("lookup"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { status, from, to, cursor, lookup } = parsed.data;

    // A lookup answers on its own terms: filters and paging do not apply to
    // "show me this exact reference".
    if (lookup) {
      const payments = await lookupTransactions({ tenantId, term: lookup });
      return NextResponse.json({
        success: true,
        data: { payments, nextCursor: null, totals: null, isLookup: true },
      });
    }

    const filters = {
      status,
      // Dates arrive as plain days. The end of a day is inclusive, which a
      // bare `new Date("2026-10-16")` is not - it is that day's midnight,
      // and would exclude everything that happened during it.
      // In Lagos, not the server's zone: on the UTC VPS a bare
      // `T00:00` started the day at 01:00 for everyone reading it, so a
      // dashboard card linking here for "this month" disagreed with it.
      from: from ? startOfDisplayZoneDate(from) : null,
      to: to ? endOfDisplayZoneDate(to) : null,
    };

    const [page, totals] = await Promise.all([
      queryTransactions({ tenantId, filters, cursor }),
      // Only on the first page. Turning a page does not change the totals,
      // and three aggregations per click is three reads nobody asked for.
      cursor ? Promise.resolve(null) : getTransactionTotals({ tenantId, filters }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        payments: page.payments,
        nextCursor: page.nextCursor,
        totals,
        pageSize: TRANSACTIONS_PAGE_SIZE,
        isLookup: false,
      },
    });
  } catch (error) {
    console.error("GET transactions error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
