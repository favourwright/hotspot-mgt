import { Suspense } from "react";
import { AppShell } from "@/components/system/app-shell";
import { PaymentReturn } from "@/components/shared/payment-return";

/**
 * Where Monnify's checkout brings a payer back to, on the tenant's own subdomain: a
 * voucher sale (portal or storefront), a plan payment or an addon. See
 * components/shared/payment-return.tsx and lib/checkout-return.ts.
 */
export default async function PaymentReturnPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  return (
    <AppShell center>
      <Suspense fallback={null}>
        <PaymentReturn tenantSlug={tenantSlug} />
      </Suspense>
    </AppShell>
  );
}
