"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { useVouchers } from "@/hooks/use-vouchers";
import { useActiveUsers } from "@/hooks/use-active-users";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Copy, CheckCircle } from "lucide-react";

// Hardcoded placeholder users for padding when not enough real users
const PLACEHOLDER_USERS = [
  {
    name: "Felix M.",
    initials: "SM",
    image: "https://api.dicebear.com/10.x/thumbs/svg?seed=Felix",
    isPlaceholder: true
  },
  {
    name: "Aneka O.",
    initials: "AO",
    image: "https://api.dicebear.com/10.x/thumbs/svg?seed=Aneka",
    isPlaceholder: true
  },
  {
    name: "Luna K.",
    initials: "JK",
    image: "https://api.dicebear.com/10.x/thumbs/svg?seed=Luna",
    isPlaceholder: true
  },
];

export default function MyVouchersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: vouchers, isLoading } = useVouchers();
  const { data: activeUsers } = useActiveUsers(!!user && !authLoading);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Helper to get user initials from email
  const getUserInitials = (email: string) => {
    const parts = email.split("@")[0];
    return parts.slice(0, 2).toUpperCase();
  };

  // Combine real users with placeholders to always show 3 avatars
  const realUsers = (activeUsers || []).map(user => ({
    email: user.userEmail,
    initials: getUserInitials(user.userEmail),
    isPlaceholder: false,
    name: undefined,
    image: undefined
  }));
  
  const displayUsers = [
    ...realUsers,
    ...PLACEHOLDER_USERS.slice(0, Math.max(0, 3 - realUsers.length))
  ].slice(0, 3);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/my-vouchers");
    }
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

  if (authLoading || isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading vouchers...</div>
      </div>
    );
  }

  if (!vouchers || vouchers.length === 0) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <div className="flex -space-x-2 *:data-[slot=avatar]:size-12 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background *:data-[slot=avatar]:grayscale">
                {displayUsers.map((user, index) => (
                  <Avatar key={index} data-slot="avatar" className="bg-black">
                    {user.isPlaceholder && user.image ? (
                      <AvatarImage src={user.image} alt={user.name} />
                    ) : null}
                    <AvatarFallback className="font-semibold">
                      {user.initials}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
            </EmptyMedia>
            <EmptyTitle>Join Others Getting Connected</EmptyTitle>
            <EmptyDescription>
              {realUsers.length > 0 
                ? `${realUsers.length} ${realUsers.length === 1 ? 'person is' : 'people are'} already enjoying fast internet. Purchase a plan to get instant access!`
                : "Many people are already enjoying fast internet. Purchase a plan to get instant access!"
              }
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => router.push("/")}>Browse Plans</Button>
          </EmptyContent>
        </Empty>
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
              <Card key={voucher.id} className="shadow-lg shadow-black/5">
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
