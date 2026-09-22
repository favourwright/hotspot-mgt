import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PlansTable } from "@/components/admin/plans-table";

export default async function PlansPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");

  if (!session) {
    redirect("/login");
  }

  // Pass empty arrays and let client fetch
  const initialPlans: never[] = [];
  const initialLocations: never[] = [];

  return (
    <div className="container mx-auto px-4 py-8">
      <PlansTable initialPlans={initialPlans} initialLocations={initialLocations} />
    </div>
  );
}
