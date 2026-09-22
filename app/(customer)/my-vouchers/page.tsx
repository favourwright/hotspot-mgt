"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, CheckCircle } from "lucide-react";

interface Voucher {
  id: string;
  username: string;
  password: string;
  planName: string;
  locationName: string;
  duration: string;
  dataLimit?: string;
  status: "active" | "failed" | "expired";
  createdAt: any;
}

export default function MyVouchersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/my-vouchers");
      return;
    }

    if (!user) return;

    async function fetchVouchers() {
      if (!db) return; // Guard against undefined db
      
      try {
        const vouchersQuery = query(
          collection(db, COLLECTIONS.VOUCHERS),
          where("userId", "==", user!.uid),
          orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(vouchersQuery);
        const vouchersData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as Voucher[];

        setVouchers(vouchersData);
      } catch (error) {
        console.error("Error fetching vouchers:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchVouchers();
  }, [user, authLoading, router]);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
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

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "failed":
        return "destructive";
      case "expired":
        return "secondary";
      default:
        return "secondary";
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading vouchers...</div>
      </div>
    );
  }

  if (vouchers.length === 0) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>My Vouchers</CardTitle>
            <CardDescription>Your purchase history will appear here</CardDescription>
          </CardHeader>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground mb-4">You haven&apos;t purchased any vouchers yet.</p>
            <Button onClick={() => router.push("/")}>Browse Plans</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">My Vouchers</h1>
        <p className="text-muted-foreground">View all your purchased internet access vouchers</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase History</CardTitle>
          <CardDescription>
            {vouchers.length} {vouchers.length === 1 ? "voucher" : "vouchers"} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Password</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell className="text-sm">
                      {formatDate(voucher.createdAt)}
                    </TableCell>
                    <TableCell>{voucher.locationName}</TableCell>
                    <TableCell>{voucher.planName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-sm">{voucher.username}</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(voucher.username, `username-${voucher.id}`)}
                        >
                          {copiedField === `username-${voucher.id}` ? (
                            <CheckCircle className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-sm">{voucher.password}</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(voucher.password, `password-${voucher.id}`)}
                        >
                          {copiedField === `password-${voucher.id}` ? (
                            <CheckCircle className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{voucher.duration}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(voucher.status)}>
                        {voucher.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile view */}
          <div className="md:hidden space-y-4">
            {vouchers.map((voucher) => (
              <Card key={voucher.id}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-base">{voucher.planName}</CardTitle>
                      <CardDescription className="text-sm">
                        {voucher.locationName}
                      </CardDescription>
                    </div>
                    <Badge variant={getStatusVariant(voucher.status)}>
                      {voucher.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date:</span>
                    <span>{formatDate(voucher.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration:</span>
                    <span>{voucher.duration}</span>
                  </div>
                  <div className="border-t pt-3 space-y-2">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-muted-foreground">Username:</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(voucher.username, `username-${voucher.id}`)}
                        >
                          {copiedField === `username-${voucher.id}` ? (
                            <CheckCircle className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                      <code className="text-xs bg-muted p-1 rounded block break-all">
                        {voucher.username}
                      </code>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-muted-foreground">Password:</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(voucher.password, `password-${voucher.id}`)}
                        >
                          {copiedField === `password-${voucher.id}` ? (
                            <CheckCircle className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                      <code className="text-xs bg-muted p-1 rounded block break-all">
                        {voucher.password}
                      </code>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-6">
            <Button onClick={() => router.push("/")} variant="outline" className="w-full">
              Buy More Vouchers
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
