import { requireSuperAdmin } from "@/lib/server-auth";
import { listCoupons } from "@/lib/coupons";
import { CouponsClient } from "@/components/superadmin/coupons-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminCouponsPage() {
  await requireSuperAdmin();

  return (
    <div className="space-y-6">
      <CouponsClient initialCoupons={await listCoupons()} />
    </div>
  );
}
