"use client";

import { useAuth } from "@/providers/auth-provider";
import { useStats } from "@/hooks/use-stats";
import { StatCard } from "@/components/admin/stats-cards";
import { DollarSign, Ticket, XCircle, Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminDashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading } = useStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">Loading dashboard...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center text-muted-foreground">Failed to load stats</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your hotspot business</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={`₦${(stats.totalRevenue / 100).toLocaleString()}`}
          icon={DollarSign}
          description="All time sales"
        />
        <StatCard
          title="Vouchers Generated"
          value={stats.totalVouchers}
          icon={Ticket}
          description={`${stats.activeVouchers} active`}
        />
        <StatCard
          title="Failed Vouchers"
          value={stats.failedVouchers}
          icon={XCircle}
          description="Requires attention"
        />
        <StatCard
          title="Today's Sales"
          value={stats.todayPayments}
          icon={Calendar}
          description={`₦${(stats.todayRevenue / 100).toLocaleString()} revenue`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Manage your hotspot system</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <a
              href="/admin/locations"
              className="block p-3 rounded-lg border hover:bg-accent transition-colors"
            >
              <div className="font-medium">Manage Locations</div>
              <div className="text-sm text-muted-foreground">
                Add or edit hotspot router locations
              </div>
            </a>
            <a
              href="/admin/plans"
              className="block p-3 rounded-lg border hover:bg-accent transition-colors"
            >
              <div className="font-medium">Manage Plans</div>
              <div className="text-sm text-muted-foreground">
                Configure pricing and data plans
              </div>
            </a>
            <a
              href="/admin/vouchers"
              className="block p-3 rounded-lg border hover:bg-accent transition-colors"
            >
              <div className="font-medium">View All Vouchers</div>
              <div className="text-sm text-muted-foreground">
                See complete voucher history
              </div>
            </a>
            {stats.failedVouchers > 0 && (
              <a
                href="/admin/failed"
                className="block p-3 rounded-lg border border-destructive/50 bg-destructive/10 hover:bg-destructive/20 transition-colors"
              >
                <div className="font-medium text-destructive">
                  Failed Vouchers ({stats.failedVouchers})
                </div>
                <div className="text-sm text-destructive/80">
                  Review and retry failed generations
                </div>
              </a>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
            <CardDescription>Current system health</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Voucher Success Rate</span>
              <span className="text-sm font-medium">
                {stats.totalVouchers > 0
                  ? `${(
                      ((stats.totalVouchers - stats.failedVouchers) /
                        stats.totalVouchers) *
                      100
                    ).toFixed(1)}%`
                  : "N/A"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Active Vouchers</span>
              <span className="text-sm font-medium">{stats.activeVouchers}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Today&apos;s Vouchers</span>
              <span className="text-sm font-medium">{stats.todayVouchers}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Failed Queue</span>
              <span
                className={`text-sm font-medium ${
                  stats.failedVouchers > 0 ? "text-destructive" : "text-green-600"
                }`}
              >
                {stats.failedVouchers === 0 ? "Clear ✓" : `${stats.failedVouchers} pending`}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
