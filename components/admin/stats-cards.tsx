import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon, DollarSign, Ticket, CheckCircle, AlertTriangle, TrendingUp, Calendar } from "lucide-react";
import { formatNaira } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
}

export function StatCard({ title, value, icon: Icon, description }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

interface StatsCardsProps {
  stats: {
    totalRevenue: number;
    totalVouchers: number;
    activeVouchers: number;
    failedVouchers: number;
    todayRevenue: number;
    todayVouchers: number;
  };
}

export function StatsCards({ stats }: StatsCardsProps) {
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
        value={stats.totalVouchers}
        icon={Ticket}
        description={`${stats.activeVouchers} active`}
      />
      <StatCard
        title="Failed Vouchers"
        value={stats.failedVouchers}
        icon={AlertTriangle}
        description="Requires retry"
      />
      <StatCard
        title="Today's Revenue"
        value={formatNaira(stats.todayRevenue)}
        icon={TrendingUp}
        description="Revenue today"
      />
      <StatCard
        title="Today's Vouchers"
        value={stats.todayVouchers}
        icon={Calendar}
        description="Sold today"
      />
      <StatCard
        title="Active Vouchers"
        value={stats.activeVouchers}
        icon={CheckCircle}
        description="Currently active"
      />
    </div>
  );
}
