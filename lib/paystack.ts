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
        metadata: result.data.metadata,
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

export async function fetchPaystackBanks(): Promise<{
  success: boolean;
  data?: PaystackBank[];
  error?: string;
}> {
  try {
    const response = await fetch(
      "https://api.paystack.co/bank?currency=NGN&country=nigeria",
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const json = await response.json();

    if (!json.status) {
      return { success: false, error: "Failed to fetch banks" };
    }

    const banks = json.data.map((bank: Record<string, string>) => ({
      name: bank.name,
      code: bank.code,
      slug: bank.slug,
    }));

    // Deduplicate by code at the source
    const uniqueBanks = banks.filter(
      (bank: { code: string }, index: number, self: { code: string }[]) =>
        index === self.findIndex((b) => b.code === bank.code)
    );

    return {
      success: true,
      data: uniqueBanks,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

export async function verifyPaystackAccount(
  accountNumber: string,
  bankCode: string
): Promise<{
  success: boolean;
  data?: { accountName: string; accountNumber: string };
  error?: string;
}> {
  try {
    const response = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Could not verify account",
      };
    }

    return {
      success: true,
      data: {
        accountName: json.data.account_name,
        accountNumber: json.data.account_number,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

export async function createPaystackSubaccount(params: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number;
}): Promise<{
  success: boolean;
  data?: { subaccountCode: string; id: number };
  error?: string;
}> {
  try {
    const response = await fetch("https://api.paystack.co/subaccount", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        business_name: params.businessName,
        settlement_bank: params.bankCode,
        account_number: params.accountNumber,
        percentage_charge: params.percentageCharge,
      }),
    });

    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Failed to create subaccount",
      };
    }

    return {
      success: true,
      data: {
        subaccountCode: json.data.subaccount_code,
        id: json.data.id,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
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

export async function createPaystackPlan(params: {
  name: string;
  amount: number;
  /**
   * Paystack's own interval vocabulary. Widened from "monthly" only when
   * addons arrived, since an addon may be sold yearly. BillingPlan still
   * only ever passes "monthly".
   */
  interval: "monthly" | "annually";
}): Promise<{
  success: boolean;
  data?: { planCode: string };
  error?: string;
}> {
  try {
    const response = await fetch("https://api.paystack.co/plan", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: params.name,
        amount: params.amount,
        interval: params.interval,
      }),
    });

    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Failed to create billing plan",
      };
    }

    return {
      success: true,
      data: { planCode: json.data.plan_code },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

export async function updatePaystackPlan(
  planCode: string,
  params: { amount: number }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://api.paystack.co/plan/${encodeURIComponent(planCode)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: params.amount }),
      }
    );

    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Failed to update billing plan",
      };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Read one subscription, chiefly for its `email_token`.
 *
 * Paystack requires that token to disable a subscription and only returns it
 * when the subscription is created - which this app never stored. So the
 * only way to cancel one is to fetch it first.
 */
export async function fetchPaystackSubscription(code: string): Promise<{
  success: boolean;
  data?: {
    emailToken: string | null;
    status: string;
    nextPaymentDate: string | null;
  };
  error?: string;
}> {
  try {
    const response = await fetch(
      `https://api.paystack.co/subscription/${code}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );
    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Failed to fetch subscription",
      };
    }

    return {
      success: true,
      data: {
        emailToken: json.data?.email_token ?? null,
        status: json.data?.status ?? "unknown",
        nextPaymentDate: json.data?.next_payment_date ?? null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Stop a subscription renewing.
 *
 * Paystack's semantics are "will not renew", not "stopped now" - the tenant
 * keeps what they have already paid for until the period ends. The resulting
 * `subscription.disable` webhook is what actually moves our own state, so
 * nothing here writes to Firestore: two writers would mean either drift or
 * two cancellation emails.
 */
export async function disablePaystackSubscription(
  code: string,
  emailToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.paystack.co/subscription/disable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, token: emailToken }),
    });
    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Failed to cancel subscription",
      };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

export async function createPaystackCustomer(params: {
  email: string;
  firstName?: string;
  lastName?: string;
}): Promise<{
  success: boolean;
  data?: { customerCode: string };
  error?: string;
}> {
  try {
    const response = await fetch("https://api.paystack.co/customer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
      }),
    });

    const json = await response.json();

    if (!json.status) {
      return {
        success: false,
        error: json.message || "Failed to create customer",
      };
    }

    return {
      success: true,
      data: { customerCode: json.data.customer_code },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Create a subscription that starts on a date of our choosing.
 *
 * The only way to say "bill them, but not yet". Paystack Inline can open a
 * Plan and subscribe, but it always charges there and then - which is wrong
 * for a tenant paying during a trial they have already been given. They are
 * buying the first month *after* the free window, so recurring billing has
 * to begin one interval after that window closes, not today.
 *
 * Needs a reusable `authorizationCode` from a charge that already succeeded;
 * there is no way to schedule against a card Paystack has not seen. The
 * caller gets `null` back when the charge produced no reusable token, and
 * must then fall back to asking the tenant again later rather than silently
 * leaving them unsubscribed.
 *
 * `startDate` is sent as ISO 8601, which is the only format the endpoint
 * accepts for a future first charge.
 */
export async function createPaystackSubscription(input: {
  customerCode: string;
  planCode: string;
  authorizationCode: string;
  startDate: Date;
}): Promise<{
  success: boolean;
  data?: { subscriptionCode: string; emailToken: string | null };
  error?: string;
}> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return { success: false, error: "Paystack secret key is not configured" };
  }

  try {
    const response = await fetch("https://api.paystack.co/subscription", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: input.customerCode,
        plan: input.planCode,
        authorization: input.authorizationCode,
        start_date: input.startDate.toISOString(),
      }),
    });

    const json = await response.json();

    if (!response.ok || !json.status) {
      return {
        success: false,
        error: json.message || "Failed to create subscription",
      };
    }

    return {
      success: true,
      data: {
        subscriptionCode: json.data.subscription_code,
        // Returned once, at creation, and never again - which is the whole
        // reason cancelling has to go and fetch it. Stored by the caller so
        // the cancel path does not depend on that second call succeeding.
        emailToken: json.data.email_token ?? null,
      },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error creating subscription",
    };
  }
}
