"use client";

import { PlansTable } from "@/components/admin/plans-table";

export default function PlansPage() {
  const initialPlans: never[] = [];
  const initialLocations: never[] = [];

  return (
    <div className="container mx-auto px-4 py-8">
      <PlansTable initialPlans={initialPlans} initialLocations={initialLocations} />
    </div>
  );
}
