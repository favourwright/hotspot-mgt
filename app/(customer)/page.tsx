"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { useAuth } from "@/lib/auth-context";
import { Location, Plan } from "@/types";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface LocationWithPlans {
  location: Location;
  plans: Plan[];
}

export default function CustomerHomePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [locations, setLocations] = useState<LocationWithPlans[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/");
      return;
    }

    if (!user) return;

    async function fetchData() {
      if (!db) return; // Guard against undefined db
      
      try {
        // Fetch active locations
        const locationsQuery = query(
          collection(db, COLLECTIONS.LOCATIONS),
          where("isActive", "==", true)
        );
        const locationsSnapshot = await getDocs(locationsQuery);
        const locationsData = locationsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Location[];

        // Fetch active plans
        const plansQuery = query(
          collection(db, COLLECTIONS.PLANS),
          where("isActive", "==", true)
        );
        const plansSnapshot = await getDocs(plansQuery);
        const plansData = plansSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Plan[];

        // Group plans by location
        const locationsWithPlans: LocationWithPlans[] = locationsData.map(location => ({
          location,
          plans: plansData.filter(plan => plan.locationId === location.id)
        }));

        setLocations(locationsWithPlans);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
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

  if (authLoading || loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading plans...</div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>No Plans Available</CardTitle>
            <CardDescription>
              There are no active plans at the moment. Please check back later.
            </CardDescription>
          </CardHeader>
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
