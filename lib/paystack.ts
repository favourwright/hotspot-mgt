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
