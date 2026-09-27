"use client";

import { Card } from "@/components/ui/card";
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
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-2xl font-bold mt-1">{card.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            </div>
            <card.icon className="h-5 w-5 text-muted-foreground shrink-0" />
          </div>
        </Card>
      ))}
    </div>
  );
}
