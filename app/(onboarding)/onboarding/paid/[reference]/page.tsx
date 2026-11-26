"use client";

/**
 * Where a signup's checkout comes back to (lib/knomad-pay.ts, signupPaymentReturnUrl).
 * It hands the payment to the confirm step, which finishes the signup with it, and goes
 * back to the wizard; Monnify's own `?paymentReference=` is ignored.
 */
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { noteSignupReturn } from "@/lib/checkout-return";

export default function SignupPaidPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = use(params);
  const router = useRouter();
  useEffect(() => {
    noteSignupReturn(decodeURIComponent(reference));
    router.replace("/onboarding");
  }, [reference, router]);
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6 text-sm text-muted-foreground">
      Finishing your signup...
    </main>
  );
}
