"use client";

import { useState } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useFailedVouchers, useRetryVoucher } from "@/hooks/use-failed-vouchers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, AlertTriangle } from "lucide-react";

export default function FailedVouchersPage() {
  const { user } = useAuth();
  const { data: vouchers = [], isLoading } = useFailedVouchers();
  const retryVoucher = useRetryVoucher();
  const [retryingAll, setRetryingAll] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleRetry = async (voucherId: string) => {
    if (!user) return;

    setMessage(null);

    try {
      await retryVoucher.mutateAsync(voucherId);
      setMessage({ type: "success", text: "Voucher activated successfully!" });
    } catch (error) {
      console.error("Error retrying voucher:", error);
      setMessage({ 
        type: "error", 
        text: error instanceof Error ? error.message : "Retry failed" 
      });
    }
  };

  const handleRetryAll = async () => {
    if (!user || vouchers.length === 0) return;

    setRetryingAll(true);
    setMessage(null);

    let successCount = 0;
    let failCount = 0;

    for (const voucher of vouchers) {
      try {
        await retryVoucher.mutateAsync(voucher.id);
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    setMessage({
      type: successCount > 0 ? "success" : "error",
      text: `Retry completed: ${successCount} succeeded, ${failCount} failed`,
    });

    setRetryingAll(false);
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">Loading failed vouchers...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Failed Vouchers</h1>
          <p className="text-muted-foreground">
            {vouchers.length} voucher{vouchers.length !== 1 ? "s" : ""} require{vouchers.length === 1 ? "s" : ""} attention
          </p>
        </div>
        {vouchers.length > 0 && (
          <Button
            onClick={handleRetryAll}
            disabled={retryingAll}
            variant="default"
          >
            {retryingAll ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Retrying All...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry All ({vouchers.length})
              </>
            )}
          </Button>
        )}
      </div>

      {message && (
        <Alert variant={message.type === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {vouchers.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <div className="text-green-600 mb-2">✓</div>
            <p className="text-lg font-medium">No Failed Vouchers</p>
            <p className="text-sm text-muted-foreground">All vouchers generated successfully</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Failed Queue</CardTitle>
            <CardDescription>Vouchers that failed MikroTik generation</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Failure Reason</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Last Retry</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell className="text-sm">{formatDate(voucher.createdAt)}</TableCell>
                    <TableCell className="text-sm">{voucher.userEmail}</TableCell>
                    <TableCell>{voucher.locationName}</TableCell>
                    <TableCell>{voucher.planName}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="flex items-start gap-2">
                        {(voucher.retryCount || 0) >= 3 && (
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        )}
                        <span className="text-sm text-muted-foreground line-clamp-2">
                          {voucher.failureReason || "Unknown error"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={(voucher.retryCount || 0) >= 3 ? "destructive" : "secondary"}>
                        {voucher.retryCount || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {voucher.lastRetryAt ? formatDate(voucher.lastRetryAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => handleRetry(voucher.id)}
                        disabled={retryVoucher.isPending || retryingAll}
                      >
                        {retryVoucher.isPending && retryVoucher.variables === voucher.id ? (
                          <>
                            <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                            Retrying...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Retry
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {vouchers.length > 0 && (
        <Alert>
          <AlertDescription>
            <p className="font-medium mb-1">About Failed Vouchers</p>
            <p className="text-sm">
              These vouchers failed during MikroTik hotspot user creation. Payment was received
              successfully, so customers are entitled to these credentials. Use the retry button to
              attempt generation again. Common causes: router connectivity issues, incorrect
              MikroTik profile names, or router authentication problems.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
