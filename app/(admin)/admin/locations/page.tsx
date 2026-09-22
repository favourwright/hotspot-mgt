"use client";

import { LocationsTable } from "@/components/admin/locations-table";

export default function LocationsPage() {
  const initialLocations: never[] = [];

  return (
    <div className="container mx-auto px-4 py-8">
      <LocationsTable initialLocations={initialLocations} />
    </div>
  );
}
