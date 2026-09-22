"use client";

import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleSignOut = async () => {
    await logout();
  };

  const isActive = (path: string) => pathname === path;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-bold">Hotspot Portal</h1>
            {user && (
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {user.email}
                </span>
                <Button variant="outline" size="sm" onClick={handleSignOut}>
                  Sign Out
                </Button>
              </div>
            )}
          </div>
          {user && (
            <nav className="flex gap-2">
              <Link href="/">
                <Button variant={isActive("/") ? "default" : "ghost"} size="sm">
                  Buy Plans
                </Button>
              </Link>
              <Link href="/my-vouchers">
                <Button variant={isActive("/my-vouchers") ? "default" : "ghost"} size="sm">
                  My Vouchers
                </Button>
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
