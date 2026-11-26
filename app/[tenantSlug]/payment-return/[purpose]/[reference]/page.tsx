import { notFound } from "next/navigation";
import { AppShell } from "@/components/system/app-shell";
import { PaymentReturn } from "@/components/shared/payment-return";

/**
 * Where Monnify's checkout brings a payer back to, on the tenant's own subdomain: a
 * voucher sale (portal or storefront), a plan payment or an addon. The purpose and the
 * reference are in the path (lib/knomad-pay.ts, tenantPaymentReturnUrl); Monnify's own
 * `?paymentReference=` is ignored. See components/shared/payment-return.tsx.
 */
export default async function PaymentReturnPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; purpose: string; reference: string }>;
}) {
  const { tenantSlug, purpose, reference } = await params;
  if (purpose !== "voucher" && purpose !== "billing") notFound();
  return (
    <AppShell center>
      <PaymentReturn tenantSlug={tenantSlug} purpose={purpose} reference={decodeURIComponent(reference)} />
    </AppShell>
  );
}
