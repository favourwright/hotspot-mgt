"use client";

import {
  DollarSign,
  Ticket,
  CircleCheck,
  AlertTriangle,
  TrendingUp,
  Calendar,
} from "lucide-react";

import { formatNaira } from "@/lib/utils";
import { useAdminStats } from "@/hooks/use-stats";
import { AdminStats } from "@/services/admin-service";
import { StatCard } from "@/components/system/stat-card";

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
  // Seeded with the server component's fetch for an instant first paint —
  // actions elsewhere (e.g. retrying a failed voucher) invalidate this
  // query, which refetches it in the background, no full page reload needed.
  const { data: stats = initialStats } = useAdminStats(initialStats);

  const base = `/${tenantSlug}/admin`;
  const toVouchers = { label: "View details", href: `${base}/vouchers` };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Total Revenue"
        value={formatNaira(stats.totalRevenue)}
        icon={DollarSign}
        description="All time revenue"
      />
      <StatCard
        title="Total Vouchers"
        action={toVouchers}
        value={stats.totalVouchers}
        icon={Ticket}
        description={`${stats.activeVouchers} active`}
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
        value={formatNaira(stats.todayRevenue)}
        icon={TrendingUp}
        description="Revenue today"
      />
      <StatCard
        title="Today's Vouchers"
        action={toVouchers}
        value={stats.todayVouchers}
        icon={Calendar}
        description="Sold today"
      />
      <StatCard
        title="Active Vouchers"
        action={toVouchers}
        value={stats.activeVouchers}
        icon={CircleCheck}
        description="Currently active"
      />
    </div>
  );
}
