"use client";

import { StatCard } from "@/components/system/stat-card";
import {
  Building2,
  CheckCircle,
  XCircle,
  Ticket,
  TrendingUp,
  DollarSign,
} from "lucide-react";

interface SuperAdminStatsCardsProps {
  stats: {
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    totalVouchersAllTenants: number;
    totalRevenueAllTenants: number;
    todayRevenueAllTenants: number;
    mrr: number;
  };
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`;
}

export function SuperAdminStatsCards({ stats }: SuperAdminStatsCardsProps) {
  const cards = [
    {
      label: "Total Tenants",
      value: stats.totalTenants,
      sub: `${stats.activeTenants} active`,
      icon: Building2,
    },
    {
      label: "Platform Revenue",
      value: formatNaira(stats.totalRevenueAllTenants),
      sub: `${formatNaira(stats.todayRevenueAllTenants)} today`,
      icon: DollarSign,
    },
    {
      label: "MRR",
      value: formatNaira(stats.mrr),
      sub: "Monthly recurring revenue",
      icon: TrendingUp,
    },
    {
      label: "Total Vouchers",
      value: stats.totalVouchersAllTenants,
      sub: "Across all tenants",
      icon: Ticket,
    },
    {
      label: "Active Tenants",
      value: stats.activeTenants,
      sub: "Paying and using platform",
      icon: CheckCircle,
    },
    {
      label: "Suspended",
      value: stats.suspendedTenants,
      sub: "Needs attention",
      icon: XCircle,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <StatCard
          key={card.label}
          title={card.label}
          value={card.value}
          description={card.sub}
          icon={card.icon}
          // The one card here that wants acting on.
          inverted={card.label === "Suspended"}
        />
      ))}
    </div>
  );
}
