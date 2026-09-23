"use client";

import { useState } from "react";
import { usePlans, useTogglePlan } from "@/hooks/use-plans";
import { useLocations } from "@/hooks/use-locations";
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { MapPin, CreditCard } from "lucide-react";

interface Location {
  id: string;
  name: string;
}

interface PlansTableProps {
  initialPlans: never[];
  initialLocations: never[];
}

export function PlansTable({ initialPlans, initialLocations }: PlansTableProps) {
  const { data: plans, isLoading: plansLoading } = usePlans();
  const { data: locations, isLoading: locationsLoading } = useLocations();
  const togglePlan = useTogglePlan();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const isLoading = plansLoading || locationsLoading;

  const handleToggleActive = async (planId: string, currentActive: boolean) => {
    try {
      await togglePlan.mutateAsync({ id: planId, active: !currentActive });
    } catch (error) {
      console.error("Toggle error:", error);
      alert("Failed to update plan status");
    }
  };

  const formatPrice = (kobo: number) => {
    return `₦${(kobo / 100).toFixed(2)}`;
  };

  const groupedPlans =
    locations?.map((location) => ({
      location,
      plans: plans?.filter((plan) => plan.locationId === location.id) || [],
    })) || [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900"></div>
      </div>
    );
  }

  if (!locations || locations.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Plans</h2>
          <p className="text-gray-600">Manage your hotspot plans</p>
        </div>
        <Card>
          <div className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MapPin />
                </EmptyMedia>
                <EmptyTitle>No Locations Found</EmptyTitle>
                <EmptyDescription>
                  You need to add a location before creating plans. Go to the Locations page to add your first MikroTik router.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </Card>
      </div>
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
                      <TableCell colSpan={7} className="p-0">
                        <Empty className="py-8">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <CreditCard />
                            </EmptyMedia>
                            <EmptyTitle className="text-base">No Plans Yet</EmptyTitle>
                            <EmptyDescription className="text-sm">
                              Create your first plan for this location to start selling vouchers.
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedLocation(location);
                                setDialogOpen(true);
                              }}
                            >
                              Add Plan
                            </Button>
                          </EmptyContent>
                        </Empty>
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
                            disabled={togglePlan.isPending}
                          >
                            {togglePlan.isPending && togglePlan.variables?.id === plan.id
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
          onSuccess={() => setDialogOpen(false)}
          locationId={selectedLocation.id}
          locationName={selectedLocation.name}
        />
      )}
    </div>
  );
}
