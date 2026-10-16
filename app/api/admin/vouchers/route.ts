/**
 * Pages, totals and lookups for both voucher lists.
 *
 * Same arrangement as `/api/admin/transactions`, which this is modelled on:
 * each page server-renders its own first page, so this exists for everything
 * after that - turning a page, changing a filter, running a lookup, or
 * reloading after a retry. `verifyTenantAccessBySlug` like the rest of
 * `/api/admin/*`, so an owner is scoped to their own tenant and a superadmin
 * has to name one.
 *
 * This replaces a `GET` that returned a tenant's **entire** voucher
 * collection as one array. Nothing asks for that shape any more, and
 * nothing should: it is the read that grows without bound.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import {
  FAILED_PAGE_SIZE,
  VOUCHERS_PAGE_SIZE,
  getVoucherCount,
  getVoucherTotals,
  lookupVouchers,
  queryVouchers,
} from "@/lib/vouchers-list";

const paramsSchema = z.object({
  status: z
    .enum(["active", "expired", "failed", "superseded"])
    .nullable()
    .default(null),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
  cursor: z.string().nullable().default(null),
  /** An exact username or email. Answered by its own query, not a filter. */
  lookup: z.string().nullable().default(null),
  /**
   * Which page this is for. The failed queue pages in smaller batches and
   * wants a bare count rather than the three figures the history shows, so
   * it says which it is rather than the route inferring it from
   * `status=failed` - a history filtered to failed is still the history.
   */
  view: z.enum(["history", "failed"]).default("history"),
  /**
   * Force the totals even on a page other than the first.
   *
   * Normally they come back only with page one, because turning a page does
   * not change them. A retry does: the voucher that succeeded leaves the
   * failed set. Without this the failed queue would keep showing the count
   * it had before the retry while the row was visibly gone from the table.
   */
  recount: z.enum(["1"]).nullable().default(null),
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
      view: url.get("view") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { status, from, to, cursor, lookup, view, recount } = parsed.data;
    const isFailedView = view === "failed";
    const pageSize = isFailedView ? FAILED_PAGE_SIZE : VOUCHERS_PAGE_SIZE;

    // A lookup answers on its own terms: filters and paging do not apply to
    // "show me this exact username".
    if (lookup && !isFailedView) {
      const vouchers = await lookupVouchers({ tenantId, term: lookup });
      return NextResponse.json({
        success: true,
        data: {
          vouchers,
          nextCursor: null,
          totals: null,
          pageSize,
          isLookup: true,
        },
      });
    }

    const filters = {
      // The failed queue is one status by definition; it cannot be widened
      // by a query parameter.
      status: isFailedView ? ("failed" as const) : status,
      // Dates arrive as plain days. The end of a day is inclusive, which a
      // bare `new Date("2026-10-16")` is not - that is the day's midnight,
      // and would exclude everything that happened during it.
      from: from ? new Date(`${from}T00:00:00.000`) : null,
      to: to ? new Date(`${to}T23:59:59.999`) : null,
    };

    const [page, totals] = await Promise.all([
      queryVouchers({ tenantId, filters, cursor, pageSize }),
      // Only on the first page, or when the caller says the set itself
      // changed. Turning a page does not change the totals, and recounting
      // per click is reads nobody asked for.
      cursor && !recount
        ? Promise.resolve(null)
        : isFailedView
          ? getVoucherCount({ tenantId, filters }).then((count) => ({
              count,
              activeCount: 0,
              todayCount: 0,
            }))
          : getVoucherTotals({ tenantId, filters }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        vouchers: page.vouchers,
        nextCursor: page.nextCursor,
        totals,
        pageSize,
        isLookup: false,
      },
    });
  } catch (error) {
    console.error("GET vouchers error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
