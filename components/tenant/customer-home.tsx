"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckoutDialog } from "@/components/shared/checkout-dialog";
import { TenantNav } from "@/components/tenant/tenant-nav";
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
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const handleBuyPlan = (plan: Plan) => {
    setSelectedPlan(plan);
    setCheckoutOpen(true);
  };

  // Group plans by location
  const plansByLocation = locations.map((location) => ({
    location,
    plans: plans.filter((plan) => plan.locationId === location.id),
  })).filter((group) => group.plans.length > 0);

  if (plansByLocation.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <TenantNav businessName={tenant.businessName} slug={tenant.slug} />
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState
            title="No Plans Available"
            description="This portal does not have any active plans yet. Check back later."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TenantNav businessName={tenant.businessName} slug={tenant.slug} />
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">{tenant.businessName}</h1>
            <p className="text-muted-foreground">
              Select a plan to get started with internet access
            </p>
          </div>

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
                        >
                          Buy Now
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {selectedPlan && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          plan={selectedPlan}
          subaccountCode={tenant.paystackSubaccountCode}
          tenantId={tenant.id}
        />
      )}
    </div>
  );
}
