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
