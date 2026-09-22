"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { useAuth } from "@/providers/auth-provider";
import { useCustomerPlans } from "@/hooks/use-customer-plans";
import { Plan } from "@/types";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function CustomerHomePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: locations, isLoading, error } = useCustomerPlans();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/");
    }
  }, [user, authLoading, router]);

  const handleBuyNow = (plan: Plan, locationName: string) => {
    const checkoutData = {
      planId: plan.id,
      planName: plan.name,
      locationId: plan.locationId,
      locationName,
      price: plan.price,
      duration: plan.duration,
      dataLimit: plan.dataLimit
    };
    localStorage.setItem("checkoutPlan", JSON.stringify(checkoutData));
    router.push("/checkout");
  };

  if (authLoading || isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading plans...</div>
      </div>
    );
  }

  // Check if Firebase is configured
  if (!db) {
    return (
      <div className="container mx-auto py-8">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Firebase Not Configured</CardTitle>
            <CardDescription>
              The application needs to be set up with Firebase credentials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-2">Setup Required</p>
                <p className="text-sm">
                  Please configure your Firebase credentials in the <code>.env.local</code> file.
                </p>
              </AlertDescription>
            </Alert>
            <div className="text-sm space-y-2">
              <p className="font-medium">Steps to fix:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Create a Firebase project at https://console.firebase.google.com</li>
                <li>Copy your Firebase config values</li>
                <li>Update <code>.env.local</code> with your actual credentials</li>
                <li>Restart the development server</li>
              </ol>
            </div>
            <p className="text-sm text-muted-foreground">
              See <code>QUICK_SETUP.md</code> for detailed instructions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!locations || locations.length === 0) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>No Plans Available</CardTitle>
            <CardDescription>
              There are no active plans at the moment. Please check back later or contact support.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              It looks like the administrator hasn&apos;t set up any plans yet.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Buy Internet Access</h1>
        <p className="text-muted-foreground">
          Select a plan and get instant access to our hotspot network
        </p>
      </div>

      {locations.length === 1 ? (
        <div>
          <h2 className="text-2xl font-semibold mb-4">{locations[0].location.name}</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {locations[0].plans.map((plan) => (
              <Card key={plan.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>
                    <span className="text-3xl font-bold text-foreground">
                      ₦{(plan.price / 100).toFixed(2)}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duration:</span>
                      <span className="font-medium">{plan.duration}</span>
                    </div>
                    {plan.dataLimit && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Data Limit:</span>
                        <span className="font-medium">{plan.dataLimit}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    className="w-full" 
                    onClick={() => handleBuyNow(plan, locations[0].location.name)}
                  >
                    Buy Now
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <Tabs defaultValue={locations[0].location.id}>
          <TabsList className="mb-4">
            {locations.map(({ location }) => (
              <TabsTrigger key={location.id} value={location.id}>
                {location.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {locations.map(({ location, plans }) => (
            <TabsContent key={location.id} value={location.id}>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plans.length === 0 ? (
                  <Card className="col-span-full">
                    <CardHeader>
                      <CardTitle>No Plans Available</CardTitle>
                      <CardDescription>
                        There are no active plans for this location yet.
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ) : (
                  plans.map((plan) => (
                    <Card key={plan.id} className="flex flex-col">
                      <CardHeader>
                        <CardTitle>{plan.name}</CardTitle>
                        <CardDescription>
                          <span className="text-3xl font-bold text-foreground">
                            ₦{(plan.price / 100).toFixed(2)}
                          </span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1">
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Duration:</span>
                            <span className="font-medium">{plan.duration}</span>
                          </div>
                          {plan.dataLimit && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Data Limit:</span>
                              <span className="font-medium">{plan.dataLimit}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter>
                        <Button 
                          className="w-full" 
                          onClick={() => handleBuyNow(plan, location.name)}
                        >
                          Buy Now
                        </Button>
                      </CardFooter>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
