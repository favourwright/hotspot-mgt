"use client";

import {
  DollarSign,
  Ticket,
  AlertTriangle,
  TrendingUp,
  Users,
  Wifi,
} from "lucide-react";

import { formatNaira } from "@/lib/utils";
import { describeChange } from "@/lib/stats-period";
import { tenantBasePath } from "@/lib/tenant-url";
import { useAdminStats } from "@/hooks/use-stats";
import { AdminStats } from "@/services/admin-service";
import { StatCard } from "@/components/system/stat-card";
import { useHotspotCounts } from "@/hooks/use-hotspot-counts";

// Re-exported: callers imported StatCard from here before it moved into the
// system layer.
export { StatCard };

interface StatsCardsProps {
  stats: AdminStats;
  tenantSlug: string;
}

export function StatsCards({
  stats: initialStats,
  tenantSlug,
}: StatsCardsProps) {
  // Seeded with the server component's fetch for an instant first paint -
  // actions elsewhere (e.g. retrying a failed voucher) invalidate this
  // query, which refetches it in the background, no full page reload needed.
  const { data: stats = initialStats } = useAdminStats(initialStats);

  // Router-backed, so loaded client-side and allowed to arrive late or not
  // at all -- see useHotspotCounts.
  const counts = useHotspotCounts();

  // An unreachable router must not read as a real zero.
  const countValue = (value: number | undefined) =>
    counts.isLoading ? "-" : counts.isError || value === undefined ? "-" : value;

  const unreachable =
    counts.data && counts.data.locationsReachable < counts.data.locationsTotal
      ? `${counts.data.locationsTotal - counts.data.locationsReachable} location(s) unreachable`
      : null;

  // Money and sales are this month so far; all-time lives on the pages the
  // cards link to, opened filtered to the same month (lib/dashboard-stats.ts).
  // Online and cash are added for the headline and split underneath, but
  // only once a tenant has sold a generated code this month: until then
  // "₦0 cash" is noise on a dashboard that has never printed a card.
  const { month, today, lastMonth } = stats;
  const monthTotal = month.onlineKobo + month.cashKobo;
  const todayTotal = today.onlineKobo + today.cashKobo;
  const split = (online: number, cash: number) =>
    `${formatNaira(online)} online, ${formatNaira(cash)} cash`;

  const revenueNote = [
    lastMonth
      ? describeChange(
          monthTotal,
          lastMonth.figures.onlineKobo + lastMonth.figures.cashKobo,
          lastMonth.throughKey,
          formatNaira
        )
      : "Since the 1st",
    month.cashKobo > 0 ? split(month.onlineKobo, month.cashKobo) : null,
  ]
    .filter(Boolean)
    .join(". ");

  const vouchersNote = [
    `${stats.activeVouchers} active now`,
    lastMonth
      ? describeChange(
          month.vouchersSold,
          lastMonth.figures.vouchersSold,
          lastMonth.throughKey,
          String
        )
      : null,
  ]
    .filter(Boolean)
    .join(". ");

  const base = `${tenantBasePath(tenantSlug)}/admin`;
  const thisMonth = `from=${stats.monthStartKey}`;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Revenue This Month"
        // Transactions are the online half; the split underneath says so.
        action={{ label: "View payments", href: `${base}/transactions?${thisMonth}` }}
        value={formatNaira(monthTotal)}
        icon={DollarSign}
        description={revenueNote}
      />
      <StatCard
        title="Vouchers This Month"
        action={{ label: "View details", href: `${base}/vouchers?${thisMonth}` }}
        value={month.vouchersSold}
        icon={Ticket}
        description={vouchersNote}
      />
      {/* Inverted: the one thing on this screen that wants acting on. */}
      <StatCard
        title="Failed Vouchers"
        action={{ label: "View details", href: `${base}/failed` }}
        value={stats.failedVouchers}
        icon={AlertTriangle}
        description="Requires retry"
        inverted
      />
      <StatCard
        title="Today's Revenue"
        value={formatNaira(todayTotal)}
        icon={TrendingUp}
        description={
          today.cashKobo > 0 ? split(today.onlineKobo, today.cashKobo) : "Revenue today"
        }
      />
      <StatCard
        title="Hotspot Users"
        action={{ label: "View details", href: `${base}/users` }}
        value={countValue(counts.data?.users)}
        icon={Users}
        description={
          counts.isError
            ? "Couldn't reach the router"
            : (unreachable ?? "On your routers")
        }
      />
      <StatCard
        title="Active Now"
        action={{ label: "View details", href: `${base}/users?tab=active` }}
        value={countValue(counts.data?.activeNow)}
        icon={Wifi}
        description={
          counts.isError
            ? "Couldn't reach the router"
            : (unreachable ?? "Connected right now")
        }
      />
    </div>
  );
}
