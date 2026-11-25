export interface PaystackVerifyResult {
  success: boolean;
  data?: {
    reference: string;
    amount: number; // in kobo (divide by 100 for naira)
    currency: string;
    status: "success" | "failed" | "abandoned";
    customerEmail: string;
    /**
     * Paystack's customer code, carried through so an addon entitlement can
     * be tied to the customer its subscription will belong to. Optional
     * because Paystack omits it on some transaction shapes.
     */
    customerCode: string | null;
    /**
     * The reusable card token from this charge, needed to create a
     * subscription that starts on a future date rather than immediately.
     * Null on a charge Paystack did not tokenise (bank transfer, USSD), so
     * every caller has to handle its absence rather than assume a card.
     */
    authorizationCode: string | null;
    metadata?: Record<string, unknown>;
    paidAt: string;
    subaccount?: {
      subaccountCode: string;
      /**
       * The actual split, as Paystack reports it on the transaction.
       * `null` means Paystack named a subaccount but returned no
       * `fees_split` for this charge - genuinely unknown, which is not the
       * same as zero and must never be recorded as zero.
       */
      tenantShareKobo: number | null;
      platformShareKobo: number | null;
      /** Paystack's own fee, taken from whichever side `bearer` names. */
      paystackFeeKobo: number | null;
    };
  };
  error?: string;
}

interface PaystackApiResponse {
  status: boolean;
  message: string;
  data: {
    reference: string;
    amount: number;
    currency: string;
    status: string;
    customer: {
      email: string;
      /** Needed to tie an addon entitlement to the Paystack customer. */
      customer_code?: string;
    };
    authorization?: {
      authorization_code?: string;
      reusable?: boolean;
    };
    metadata?: Record<string, unknown>;
    paid_at: string;
    subaccount?: {
      subaccount_code: string;
    };
    /**
     * Where Paystack actually reports the split. `integration` is the
     * platform's own cut (it equals the subaccount's `percentage_charge`
     * applied to the amount), `subaccount` is the tenant's, and `paystack`
     * is Paystack's own processing fee. Absent on an unsplit charge.
     */
    fees_split?: {
      paystack?: number;
      integration?: number;
      subaccount?: number;
    };
  };
}

/**
 * A transaction's metadata as an object, whichever shape Paystack returns.
 *
 * Inline checkout sends metadata as an object and gets one back. The
 * server-side initialize endpoint documents the field as stringified JSON,
 * and a reader that assumed an object would quietly see no planId, no
 * tenantId and no buyer - which is how a webhook stops fulfilling without
 * an error. Anything unparseable is treated as absent.
 */
export function parsePaystackMetadata(
  raw: unknown
): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A split amount only when Paystack actually reported one. */
function asKobo(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function verifyPaystackPayment(
  reference: string
): Promise<PaystackVerifyResult> {
  try {
    // Validate reference parameter
    if (!reference || typeof reference !== "string" || reference.trim() === "") {
      return { success: false, error: "Invalid reference parameter" };
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return {
        success: false,
        error: "Paystack secret key is not configured",
      };
    }

    const url = `https://api.paystack.co/transaction/verify/${encodeURIComponent(
      reference
    )}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      // Fulfilment waits on this, and so does a Paystack webhook that gives
      // up on us after its own timeout. A hung verify must fail, not hold
      // the lease until it lapses.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      let errorMessage = `Paystack API error: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json();
        if (errorBody.message) {
          errorMessage = errorBody.message;
        }
      } catch {
        // If response is not JSON, use status text
      }
      return { success: false, error: errorMessage };
    }

    const result: PaystackApiResponse = await response.json();

    // Check if Paystack API call itself was successful
    if (!result.status) {
      return {
        success: false,
        error: result.message || "Payment verification failed",
      };
    }

    // Check if payment status is success
    if (result.data.status !== "success") {
      return {
        success: false,
        error: `Payment status is ${result.data.status}, not success`,
      };
    }

    // Return successful verification result
    return {
      success: true,
      data: {
        reference: result.data.reference,
        amount: result.data.amount,
        currency: result.data.currency,
        status: result.data.status as "success" | "failed" | "abandoned",
        customerEmail: result.data.customer.email,
        customerCode: result.data.customer.customer_code ?? null,
        // Only when Paystack says it can be charged again. A one-shot
        // authorization would create a subscription whose first renewal
        // fails, which is worse than knowing now that we cannot schedule
        // one at all.
        authorizationCode:
          result.data.authorization?.reusable === true
            ? (result.data.authorization.authorization_code ?? null)
            : null,
        metadata: parsePaystackMetadata(result.data.metadata),
        paidAt: result.data.paid_at,
        // Read straight off `fees_split`. This previously read
        // `subaccount.share_of_settlement`, a field Paystack does not
        // return at all - so it was always undefined, `|| 0` turned that
        // into a confident zero, and every payment was recorded as a 100%
        // platform share. Coerce only real numbers; anything else is null.
        subaccount: result.data.subaccount
          ? {
              subaccountCode: result.data.subaccount.subaccount_code,
              tenantShareKobo: asKobo(result.data.fees_split?.subaccount),
              platformShareKobo: asKobo(result.data.fees_split?.integration),
              // Paystack's own cut. Surfaced because whose side of the split
              // it comes out of depends on the `bearer` we sent, so the
              // expected tenant share cannot be worked out without it.
              paystackFeeKobo: asKobo(result.data.fees_split?.paystack),
            }
          : undefined,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error during payment verification";
    return { success: false, error: message };
  }
}

export interface PaystackBank {
  name: string;
  code: string;
  slug: string;
}

/**
 * Read one subaccount, so the split Paystack is actually applying can be
 * checked rather than assumed.
 *
 * This matters because `percentage_charge` is set once at onboarding and
 * nothing keeps it in step with the billing plan afterwards. The only
 * trustworthy answer to "what cut are we taking from this tenant" is the one
 * Paystack gives.
 */
export async function fetchPaystackSubaccount(subaccountCode: string): Promise<{
  success: boolean;
  data?: { percentageCharge: number; businessName: string };
  error?: string;
}> {
  try {
    const response = await fetch(
      `https://api.paystack.co/subaccount/${subaccountCode}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );
    const json = await response.json();

    if (!json.status) {
      return { success: false, error: json.message || "Failed to fetch subaccount" };
    }

    return {
      success: true,
      data: {
        percentageCharge: Number(json.data.percentage_charge ?? 0),
        businessName: json.data.business_name ?? "",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Change an existing subaccount's split.
 *
 * The split is Paystack-side state, not something this app sends per charge,
 * so this is the only way to change what a live tenant is actually paid.
 * Deliberately never called automatically when a plan changes: that would
 * make editing a billing plan silently move money for every tenant on it.
 * It is an explicit action, taken per tenant, by a superadmin who meant it.
 *
 * `percentageCharge` is the platform's cut, matching how this integration
 * has always used it - `createPaystackSubaccount` is passed the plan's
 * `platformFeePercent`, and the `integration` figure Paystack reports back
 * in `fees_split` is that percentage applied to the amount.
 */
export async function updatePaystackSubaccount(
  subaccountCode: string,
  params: { percentageCharge: number }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://api.paystack.co/subaccount/${subaccountCode}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ percentage_charge: params.percentageCharge }),
      }
    );
    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Failed to update subaccount",
      };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Starts a voucher-sale transaction on the server and returns the access
 * code the browser resumes it with (`PaystackPop.resumeTransaction`).
 *
 * This is what makes the amount, the split and the metadata ours rather
 * than the browser's: the popup can only pay the transaction created here.
 * It sends exactly what the checkout dialogs used to send from the browser
 * - `subaccount` and `bearer` only when the tenant has a subaccount,
 * `transaction_charge` only when `computeCheckoutSplit` produced one - so
 * money moves the same way it always did. See docs/billing-and-payments.md
 * for why each of those conditions exists.
 */
export async function initializePaystackTransaction(params: {
  email: string;
  amountKobo: number;
  reference: string;
  metadata: Record<string, unknown>;
  subaccountCode: string | null;
  bearer: "account" | "subaccount";
  transactionChargeKobo: number | null;
}): Promise<
  | { success: true; accessCode: string }
  | { success: false; error: string }
> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return { success: false, error: "Paystack secret key is not configured" };
  }

  const body: Record<string, unknown> = {
    email: params.email,
    amount: params.amountKobo,
    currency: "NGN",
    reference: params.reference,
    metadata: params.metadata,
  };
  if (params.subaccountCode) {
    body.subaccount = params.subaccountCode;
    body.bearer = params.bearer;
    if (params.transactionChargeKobo !== null) {
      body.transaction_charge = params.transactionChargeKobo;
    }
  }

  try {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: { access_code?: string };
    };
    if (!response.ok || !json.status || !json.data?.access_code) {
      return {
        success: false,
        error: json.message || `Paystack initialize failed (${response.status})`,
      };
    }
    return { success: true, accessCode: json.data.access_code };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Paystack initialize failed",
    };
  }
}
