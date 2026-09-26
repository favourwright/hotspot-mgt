export interface PaystackVerifyResult {
  success: boolean;
  data?: {
    reference: string;
    amount: number; // in kobo (divide by 100 for naira)
    currency: string;
    status: "success" | "failed" | "abandoned";
    customerEmail: string;
    metadata?: Record<string, unknown>;
    paidAt: string;
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
    };
    metadata?: Record<string, unknown>;
    paid_at: string;
  };
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
        metadata: result.data.metadata,
        paidAt: result.data.paid_at,
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
