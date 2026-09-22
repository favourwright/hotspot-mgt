import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LocationsTable } from "@/components/admin/locations-table";

// This would need proper server-side auth check in production
export default async function LocationsPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");

  if (!session) {
    redirect("/login");
  }

  // In a real implementation, fetch locations server-side
  // For now, pass empty array and let client fetch
  const initialLocations: never[] = [];

  return (
    <div className="container mx-auto px-4 py-8">
      <LocationsTable initialLocations={initialLocations} />
    </div>
  );
}
