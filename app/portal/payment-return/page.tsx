/**
 * Where Monnify's checkout sent payers back to before checkout became a full page: charges
 * started before then still name this address. Their payments are finished without it
 * (Knomad Pay's event and the reconcile cron), so it only says so. New charges come back
 * to the tenant's own /payment-return (lib/knomad-pay.ts, tenantPaymentReturnUrl).
 */
export default function LegacyPaymentReturnPage() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Payment received</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your payment is being finished: your voucher or payment will show in your account
        within a few minutes, and you will get an email. There is no need to pay again.
      </p>
    </main>
  );
}
