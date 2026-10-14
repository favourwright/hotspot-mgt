import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantPayments } from "@/lib/firestore-helpers";
import { TransactionsClient } from "@/components/admin/transactions-client";

export default async function TenantTransactionsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  // Unbounded, like the vouchers list: this page exists to show the full
  // history, and filtering happens on the client over what's fetched.
  const payments = await getTenantPayments(tenant.id);

  return <TransactionsClient payments={payments} />;
}
