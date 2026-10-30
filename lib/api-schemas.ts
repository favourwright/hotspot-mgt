/**
 * The public shapes of every resource the API and webhooks hand out, as Zod
 * schemas: the single description of what a voucher, a payment and the rest
 * look like from outside.
 *
 * Used three ways, which is the point of having them once:
 *
 *  - webhook payloads are built from them (lib/webhook-events.ts);
 *  - the OpenAPI document will be generated from them (Phase 6), so the
 *    published docs cannot describe a field the API does not send;
 *  - `npm run test:public-api` parses each serializer's real output with
 *    `.strict()`, so a field added to a serializer without being added here
 *    fails the build instead of shipping undocumented.
 *
 * `.describe()` text is what developers will read. Keep it about meaning,
 * not implementation.
 */

import { z } from "zod";

const isoTime = z.string().describe("ISO 8601 time, UTC");
const kobo = (what: string) => z.number().int().describe(`${what}, in kobo`);

export const PublicPlanSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    priceKobo: kobo("Price"),
    duration: z.string().describe('Human-readable, e.g. "1 day"'),
    dataLimit: z.string().nullable().describe('e.g. "5GB"; null is unlimited'),
    devices: z.string().nullable().describe('Devices signed in at once, a number or "unlimited"'),
    locationId: z.string(),
    active: z.boolean(),
    createdAt: isoTime.nullable(),
  })
  .describe("A plan a customer can buy");

export const PublicLocationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    createdAt: isoTime.nullable(),
  })
  .describe("A place a business sells WiFi");

export const PublicVoucherSchema = z
  .object({
    id: z.string(),
    status: z.enum(["active", "expired", "failed", "superseded"]),
    username: z.string().describe("The login name. The password is never available"),
    customerUid: z.string(),
    customerEmail: z.string(),
    planId: z.string(),
    planName: z.string(),
    locationId: z.string(),
    duration: z.string(),
    dataLimit: z.string().nullable(),
    renewalOf: z.string().nullable().describe("The voucher this renewal took over from"),
    paymentReference: z.string().nullable(),
    createdAt: isoTime.nullable(),
    expiresAt: isoTime.nullable().describe("Null until the customer first logs in"),
  })
  .describe("A login sold to a customer");

export const PublicPaymentSchema = z
  .object({
    reference: z.string().describe("The Paystack reference"),
    status: z.enum(["pending", "success", "failed"]),
    amountKobo: kobo("What the customer paid"),
    tenantShareKobo: kobo("The business's share").nullable().describe(
      "The business's share, in kobo; null when Paystack reported no split"
    ),
    customerUid: z.string(),
    customerEmail: z.string(),
    planId: z.string(),
    planName: z.string(),
    locationId: z.string(),
    voucherId: z.string().nullable(),
    createdAt: isoTime.nullable(),
  })
  .describe("A customer's payment for a plan");

export const PublicCustomerSchema = z
  .object({
    uid: z.string(),
    email: z.string(),
    externalId: z.string().nullable().describe("The business's own id for this customer, from account linking"),
    totalVouchers: z.number().int(),
    totalSpentKobo: kobo("Lifetime spend"),
    joinedAt: isoTime.nullable(),
  })
  .describe("Someone who has bought from the business");

export type PublicVoucher = z.infer<typeof PublicVoucherSchema>;
export type PublicPayment = z.infer<typeof PublicPaymentSchema>;
