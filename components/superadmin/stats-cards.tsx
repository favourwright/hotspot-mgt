"use client";

import { StatCard } from "@/components/system/stat-card";
import {
  Building2,
  CircleCheck,
  XCircle,
  Ticket,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { formatNaira } from "@/lib/utils";
import { describeChange } from "@/lib/stats-period";
import type { PlatformOverviewStats } from "@/lib/dashboard-stats";
import type { PlatformIncome } from "@/lib/stats-rollup";

interface SuperAdminStatsCardsProps {
  stats: PlatformOverviewStats;
}

// Here rather than beside the queries in lib/dashboard-stats.ts: that module
// pulls in firebase-admin, and this is a client component. A type import is
// erased; a function import is not.
function income(i: PlatformIncome): number {
  return i.commissionKobo + i.planKobo + i.addonKobo + i.creditsKobo;
}

/**
 * Income is this month so far; all-time, by source, is the billing page the
 * card links to. Tenant and voucher counts are live.
 */
export function SuperAdminStatsCards({ stats }: SuperAdminStatsCardsProps) {
  const month = income(stats.income.month);
  const today = income(stats.income.today);
  const last = stats.income.lastMonth;

  const incomeNote = [
    last ? describeChange(month, income(last.figures), last.throughKey, formatNaira) : null,
    `${formatNaira(today)} today`,
  ]
    .filter(Boolean)
    .join(". ");

  const billing = { label: "View billing", href: "/superadmin/billing" };
  const tenants = { label: "View tenants", href: "/superadmin/tenants" };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Total Tenants"
        action={tenants}
        value={stats.totalTenants}
        description={`${stats.newTenantsThisMonth} new this month`}
        icon={Building2}
      />
      <StatCard
        title="Income This Month"
        action={billing}
        value={formatNaira(month)}
        description={incomeNote}
        icon={DollarSign}
      />
      <StatCard
        title="MRR"
        action={billing}
        value={formatNaira(stats.mrr)}
        description="What active tenants' plans charge monthly"
        icon={TrendingUp}
      />
      <StatCard
        // Active, not total: the count is of vouchers live right now.
        title="Active Vouchers"
        value={stats.activeVouchers}
        description="Across all tenants, right now"
        icon={Ticket}
      />
      <StatCard
        title="Active Tenants"
        action={tenants}
        value={stats.activeTenants}
        description="Paying and using platform"
        icon={CircleCheck}
      />
      <StatCard
        title="Suspended"
        action={tenants}
        value={stats.suspendedTenants}
        description="Needs attention"
        icon={XCircle}
        // The one card here that wants acting on.
        inverted
      />
    </div>
  );
}
