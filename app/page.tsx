import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function RootPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 text-center">
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold mb-2">Hotspot Manager</h1>
          <p className="text-muted-foreground">
            Enter your hotspot portal URL to get started.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/50 p-6 max-w-md mx-auto">
          <p className="font-medium mb-1">
            Want to manage your own hotspot business?
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Sell internet vouchers to your customers and manage your MikroTik
            routers from one dashboard.
          </p>
          <Button nativeButton={false} render={<Link href="/onboarding" />}>
            Join as a business owner &rarr;
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Have a question?{" "}
          <Link href="/faq" className="underline hover:text-foreground">
            Visit our FAQ
          </Link>
        </p>
      </div>
    </div>
  );
}
