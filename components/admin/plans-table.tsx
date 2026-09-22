"use client";

import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { AddPlanDialog } from "./add-plan-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Plan {
  id: string;
  locationId: string;
  locationName: string;
  name: string;
  price: number;
  duration: string;
  dataLimit: string;
  mikrotikProfile: string;
  active: boolean;
  createdAt: string;
}

interface Location {
  id: string;
  name: string;
}

interface PlansTableProps {
  initialPlans: Plan[];
  initialLocations: Location[];
}

export function PlansTable({ initialPlans, initialLocations }: PlansTableProps) {
  const [plans, setPlans] = useState(initialPlans);
  const [locations, setLocations] = useState(initialLocations);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const user = auth?.currentUser;
      if (!user) return;

      const token = await user.getIdToken();

      // Fetch plans
      const plansResponse = await fetch("/api/admin/plans", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const plansResult = await plansResponse.json();

      // Fetch locations
      const locationsResponse = await fetch("/api/admin/locations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const locationsResult = await locationsResponse.json();

      if (plansResult.success) setPlans(plansResult.data);
      if (locationsResult.success) setLocations(locationsResult.data);
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (planId: string, currentActive: boolean) => {
    setToggling(planId);

    try {
      const user = auth?.currentUser;
      if (!user) throw new Error("Not authenticated");

      const token = await user.getIdToken();

      const response = await fetch(`/api/admin/plans/${planId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: !currentActive }),
      });

      const result = await response.json();

      if (result.success) {
        setPlans((prev) =>
          prev.map((plan) =>
            plan.id === planId ? { ...plan, active: !currentActive } : plan
          )
        );
      } else {
        throw new Error(result.error || "Failed to update plan");
      }
    } catch (error) {
      console.error("Toggle error:", error);
      alert("Failed to update plan status");
    } finally {
      setToggling(null);
    }
  };

  const formatPrice = (kobo: number) => {
    return `₦${(kobo / 100).toFixed(2)}`;
  };

  const handleSuccess = async () => {
    await fetchData();
  };

  const groupedPlans = locations.map((location) => ({
    location,
    plans: plans.filter((plan) => plan.locationId === location.id),
  }));

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900"></div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-gray-600">
          No locations found. Please add a location first.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Plans</h2>
        <p className="text-gray-600">Manage your hotspot plans</p>
      </div>

      <Tabs defaultValue={locations[0]?.id} className="w-full">
        <TabsList>
          {locations.map((location) => (
            <TabsTrigger key={location.id} value={location.id}>
              {location.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {groupedPlans.map(({ location, plans: locationPlans }) => (
          <TabsContent key={location.id} value={location.id}>
            <Card>
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="font-semibold">{location.name} Plans</h3>
                <Button
                  onClick={() => {
                    setSelectedLocation(location);
                    setDialogOpen(true);
                  }}
                >
                  Add Plan
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan Name</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Data Limit</TableHead>
                    <TableHead>MikroTik Profile</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locationPlans.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                        No plans for this location. Click "Add Plan" to create one.
                      </TableCell>
                    </TableRow>
                  ) : (
                    locationPlans.map((plan) => (
                      <TableRow key={plan.id}>
                        <TableCell className="font-medium">{plan.name}</TableCell>
                        <TableCell>{formatPrice(plan.price)}</TableCell>
                        <TableCell>{plan.duration}</TableCell>
                        <TableCell>{plan.dataLimit}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {plan.mikrotikProfile}
                        </TableCell>
                        <TableCell>
                          <Badge variant={plan.active ? "default" : "secondary"}>
                            {plan.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleActive(plan.id, plan.active)}
                            disabled={toggling === plan.id}
                          >
                            {toggling === plan.id
                              ? "..."
                              : plan.active
                              ? "Deactivate"
                              : "Activate"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {selectedLocation && (
        <AddPlanDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={handleSuccess}
          locationId={selectedLocation.id}
          locationName={selectedLocation.name}
        />
      )}
    </div>
  );
}
