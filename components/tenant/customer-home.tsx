"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { CheckoutDialog } from "@/components/shared/checkout-dialog";
import { TenantNav } from "@/components/tenant/tenant-nav";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { useAuth } from "@/providers/auth-provider";
import { Plan, Location } from "@/types/schemas";
import { EmptyState } from "@/components/shared/empty-state";

interface TenantCustomerHomeProps {
  tenant: {
    id: string;
    slug: string;
    businessName: string;
    paystackSubaccountCode: string | null;
  };
  plans: Plan[];
  locations: Location[];
}

export function TenantCustomerHome({
  tenant,
  plans,
  locations,
}: TenantCustomerHomeProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paystackBearer, setPaystackBearer] = useState<"account" | "subaccount">("account");
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/platform/config");
        const json = await response.json();
        if (json.success && json.data.paystackBearer) {
          setPaystackBearer(json.data.paystackBearer);
        }
      } catch (error) {
        console.error("Failed to fetch platform config:", error);
      }
    };
    fetchConfig();
  }, []);

  const handleBuyPlan = async (plan: Plan) => {
    setBlockedMessage(null);

    if (!user) {
      router.push("/auth");
      return;
    }

    // Enforced here, before the Paystack popup ever opens — once a payment
    // succeeds, /api/payment/verify never blocks fulfillment.
    setCheckingAccess(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tenant/${tenant.slug}/can-purchase`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setBlockedMessage("Unable to check availability right now. Please try again.");
        return;
      }

      if (!data.data.allowed) {
        setBlockedMessage(data.data.reason || "This business isn't accepting new customers right now.");
        return;
      }

      setSelectedPlan(plan);
      setCheckoutOpen(true);
    } catch (error) {
      console.error("Can-purchase check failed:", error);
      setBlockedMessage("Unable to check availability right now. Please try again.");
    } finally {
      setCheckingAccess(false);
    }
  };

  // Group plans by location
  const plansByLocation = locations.map((location) => ({
    location,
    plans: plans.filter((plan) => plan.locationId === location.id),
  })).filter((group) => group.plans.length > 0);

  if (plansByLocation.length === 0) {
    return (
      <AppShell>
        <TenantNav businessName={tenant.businessName} slug={tenant.slug} />
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState
            title="No Plans Available"
            description="This portal does not have any active plans yet. Check back later."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TenantNav businessName={tenant.businessName} slug={tenant.slug} />
      
      <PageContent>
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">{tenant.businessName}</h1>
            <p className="text-muted-foreground">
              Select a plan to get started with internet access
            </p>
          </div>

          {blockedMessage && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{blockedMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-12">
            {plansByLocation.map(({ location, plans }) => (
              <div key={location.id}>
                <div className="mb-6">
                  <h2 className="text-2xl font-semibold mb-1">
                    {location.name}
                  </h2>
                </div>

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {plans.map((plan) => (
                    <Card key={plan.id} className="flex flex-col">
                      <CardHeader>
                        <CardTitle>{plan.name}</CardTitle>
                        <CardDescription>
                          {plan.duration} • {plan.dataLimit || "Unlimited"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1">
                        <div className="text-3xl font-bold mb-4">
                          ₦{(plan.price / 100).toLocaleString()}
                        </div>
                      </CardContent>
                      <CardFooter>
                        <Button
                          className="w-full"
                          onClick={() => handleBuyPlan(plan)}
                          disabled={checkingAccess}
                        >
                          {checkingAccess ? "Checking..." : "Buy Now"}
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PageContent>

      {selectedPlan && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          plan={selectedPlan}
          subaccountCode={tenant.paystackSubaccountCode}
          bearer={paystackBearer}
          tenantId={tenant.id}
          tenantSlug={tenant.slug}
        />
      )}
    </AppShell>
  );
}
