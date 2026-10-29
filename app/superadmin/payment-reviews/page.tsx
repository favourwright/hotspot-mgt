import { requireSuperAdmin } from "@/lib/server-auth";
import { listPaymentReviews } from "@/lib/payment-reviews";
import { PaymentReviewsClient } from "@/components/superadmin/payment-reviews-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminPaymentReviewsPage() {
  await requireSuperAdmin();

  return (
    <div className="space-y-6">
      <PaymentReviewsClient initialReviews={await listPaymentReviews()} />
    </div>
  );
}
