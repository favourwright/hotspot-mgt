"use client";

import { useCallback, useMemo, useState } from "react";
import { Voucher } from "@/types/schemas";
import { useRetryVoucher } from "@/hooks/use-failed-vouchers";
import { useAuthStore } from "@/stores/auth-store";
import { formatDate } from "@/lib/utils";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/system/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/system/empty-state";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/system/page-header";
import { apiClient } from "@/lib/api-client";

interface FailedVouchersClientProps {
  initialVouchers: Voucher[];
  initialCursor: string | null;
  /** The whole queue, not this page - counted by Firestore. */
  initialTotal: number;
  pageSize: number;
}

export function FailedVouchersClient({
  initialVouchers,
  initialCursor,
  initialTotal,
  pageSize,
}: FailedVouchersClientProps) {
  const { userRole } = useAuthStore();
  const isSuperAdmin = userRole === "superadmin";

  const [vouchers, setVouchers] = useState(initialVouchers);
  const [total, setTotal] = useState(initialTotal);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const retryVoucher = useRetryVoucher();

  // Where this page started, so a reload after a retry comes back to the
  // same place rather than to page one.
  const currentCursor = cursors[pageIndex] ?? null;

  const load = useCallback(
    async (cursor: string | null, recount = false) => {
      setLoading(true);
      try {
        const response = await apiClient.get("/api/admin/vouchers", {
          params: {
            view: "failed",
            cursor: cursor || undefined,
            // Page one always carries the count; deeper pages only ask for
            // it when a retry has actually changed the queue.
            recount: recount && cursor ? "1" : undefined,
          },
        });
        const data = response.data;
        setVouchers(data.vouchers);
        setNextCursor(data.nextCursor);
        if (data.totals) setTotal(data.totals.count);
        return data.vouchers as Voucher[];
      } catch {
        setMessage({
          type: "error",
          text: "Couldn't reload the queue. Try again.",
        });
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * After a retry the queue has changed underneath us: the voucher that
   * succeeded is no longer `failed`, so every row after it shifts back one.
   * Reloading the page we are on keeps the view honest. If that empties the
   * page - the common case, since a page of failures is usually cleared
   * together - fall back to page one, which is also where the fresh total
   * comes from.
   */
  const reloadAfterRetry = useCallback(async () => {
    const rows = await load(currentCursor, true);
    if (rows !== null && rows.length === 0 && pageIndex > 0) {
      setCursors([null]);
      setPageIndex(0);
      await load(null);
    }
  }, [currentCursor, pageIndex, load]);

  const handleRetry = async (voucherId: string) => {
    setMessage(null);
    try {
      await retryVoucher.mutateAsync(voucherId);
      setMessage({ type: "success", text: "Voucher activated successfully!" });
      await reloadAfterRetry();
    } catch (error) {
      console.error("Error retrying voucher:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Retry failed",
      });
    }
  };

  /**
   * Retries the vouchers on this page, and says so.
   *
   * It used to say "Retry all" over an array that genuinely was all of them,
   * because the page read the whole collection. It is a page now, so the
   * label only claims "all" when this page *is* the whole queue. Quietly
   * keeping the old wording would tell an owner with 300 failures that they
   * had retried all of them when 20 had been tried.
   */
  const handleRetryBatch = async () => {
    if (vouchers.length === 0) return;

    setRetryingAll(true);
    setMessage(null);

    let successCount = 0;
    let failCount = 0;

    for (const voucher of vouchers) {
      try {
        await retryVoucher.mutateAsync(voucher.id);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setMessage({
      type: successCount > 0 ? "success" : "error",
      text: `Retry completed: ${successCount} succeeded, ${failCount} failed`,
    });

    setRetryingAll(false);
    await reloadAfterRetry();
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursors((prev) => [...prev.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
    load(nextCursor);
  };

  const goPrevious = () => {
    if (pageIndex === 0) return;
    const target = cursors[pageIndex - 1] ?? null;
    setPageIndex((i) => i - 1);
    load(target);
  };

  const isWholeQueue = pageIndex === 0 && !nextCursor;
  const busy = loading || retryingAll || retryVoucher.isPending;

  const firstRow = useMemo(
    () => (vouchers.length === 0 ? 0 : pageIndex * pageSize + 1),
    [vouchers.length, pageIndex, pageSize]
  );
  const lastRow = firstRow === 0 ? 0 : firstRow + vouchers.length - 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Failed queue"
        description={
          isSuperAdmin
            ? "Viewing as superadmin - read only"
            : `${total} voucher${total !== 1 ? "s" : ""} require${total === 1 ? "s" : ""} attention`
        }
        action={
          !isSuperAdmin &&
          vouchers.length > 0 && (
            <Button tone="action" onClick={handleRetryBatch} disabled={busy}>
              <RefreshCw className={retryingAll ? "animate-spin" : undefined} />
              {retryingAll
                ? "Retrying..."
                : isWholeQueue
                  ? `Retry all (${vouchers.length})`
                  : `Retry this page (${vouchers.length})`}
            </Button>
          )
        }
      />

      {message && (
        <Alert variant={message.type === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {vouchers.length === 0 && !loading ? (
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleCheck />
                </EmptyMedia>
                <EmptyTitle>Nothing failed</EmptyTitle>
                <EmptyDescription>
                  All vouchers have been generated successfully. Failed
                  vouchers will appear here if MikroTik generation encounters
                  issues.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Failed queue</SurfaceCardTitle>
            <SurfaceCardDescription>
              Vouchers that failed MikroTik generation. Newest first.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent inset={false}>
            {loading ? (
              <TableSkeleton rows={Math.max(vouchers.length, 3)} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Failure reason</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>Last retry</TableHead>
                    {!isSuperAdmin && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vouchers.map((voucher) => (
                    <TableRow key={voucher.id}>
                      {/* The shared formatter, which pins Africa/Lagos -
                          this table used to carry its own, so a failure
                          read an hour earlier here than on the dashboard. */}
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(voucher.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {voucher.userEmail ?? "Generated code"}
                      </TableCell>
                      <TableCell>{voucher.locationName}</TableCell>
                      <TableCell>{voucher.planName}</TableCell>
                      <TableCell className="max-w-xs">
                        <div className="flex items-start gap-2">
                          {(voucher.retryCount || 0) >= 3 && (
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          )}
                          <span className="line-clamp-2 text-sm text-muted-foreground">
                            {voucher.failureReason || "Unknown error"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            (voucher.retryCount || 0) >= 3
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {voucher.retryCount || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {voucher.lastRetryAt
                          ? formatDate(voucher.lastRetryAt)
                          : "Never"}
                      </TableCell>
                      {!isSuperAdmin && (
                        <TableCell>
                          <Button
                            tone="sunken"
                            scale="sm"
                            onClick={() => handleRetry(voucher.id)}
                            disabled={busy}
                          >
                            <RefreshCw
                              className={
                                retryVoucher.isPending &&
                                retryVoucher.variables === voucher.id
                                  ? "animate-spin"
                                  : undefined
                              }
                            />
                            {retryVoucher.isPending &&
                            retryVoucher.variables === voucher.id
                              ? "Retrying..."
                              : "Retry"}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SurfaceCardContent>

          {(pageIndex > 0 || nextCursor) && (
            <SurfaceCardFooter variant="toolbar">
              <span className="text-sm text-muted-foreground">
                {firstRow}-{lastRow} of {total}
              </span>
              <div className="flex items-center gap-1 rounded-full bg-sunken p-1">
                <Button
                  tone="raised"
                  scale="sm"
                  onClick={goPrevious}
                  disabled={pageIndex === 0 || busy}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                  <span className="max-sm:sr-only">Previous</span>
                </Button>
                <Button
                  tone="raised"
                  scale="sm"
                  onClick={goNext}
                  disabled={!nextCursor || busy}
                  aria-label="Next page"
                >
                  <span className="max-sm:sr-only">Next</span>
                  <ChevronRight />
                </Button>
              </div>
            </SurfaceCardFooter>
          )}
        </SurfaceCard>
      )}

      {vouchers.length > 0 && (
        <Alert>
          <AlertDescription>
            <p className="mb-1 font-medium">About failed vouchers</p>
            <p className="text-sm">
              These vouchers failed during MikroTik hotspot user creation.
              Payment was received successfully, so customers are entitled to
              these credentials. Use the retry button to attempt generation
              again. Common causes: router connectivity issues, incorrect
              MikroTik profile names, or router authentication problems.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * Rows, not a spinner, so the card keeps its height while a page loads.
 */
function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
