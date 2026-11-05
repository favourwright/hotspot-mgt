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
 * not implementation. The `meta` id is the schema's name in the published
 * OpenAPI document (lib/openapi.ts), so renaming one is a visible change.
 */

import { z } from "zod";

/**
 * A field with what it means and an example value. The example is what the
 * generated docs show beside the field and put in the sample responses, so
 * it should look like real data, never like "string".
 */
function f<T extends z.ZodType>(schema: T, example: unknown, description?: string): T {
  return schema.meta({ ...(description ? { description } : {}), examples: [example] }) as T;
}

const isoTime = (example: string | null, description = "ISO 8601 time, UTC") =>
  f(z.string().nullable(), example, description);

export const PublicPlanSchema = z
  .object({
    id: f(z.string(), "pln_8Hq2LmZ0aB3c"),
    name: f(z.string(), "Daily 5GB"),
    priceKobo: f(z.number().int(), 50000, "Price, in kobo (50000 is 500 naira)"),
    duration: f(z.string(), "1 day", "Human-readable length of the plan"),
    dataLimit: f(z.string().nullable(), "5GB", "Data allowance; null is unlimited"),
    devices: f(z.string().nullable(), "1", 'Devices signed in at once, a number or "unlimited"'),
    locationId: f(z.string(), "loc_3cD4eF5gH6"),
    active: f(z.boolean(), true, "Whether customers can buy it"),
    createdAt: isoTime("2026-10-01T09:30:00.000Z"),
  })
  .meta({ id: "Plan", description: "A plan a customer can buy" });

export const PublicLocationSchema = z
  .object({
    id: f(z.string(), "loc_3cD4eF5gH6"),
    name: f(z.string(), "Main branch"),
    active: f(z.boolean(), true),
    createdAt: isoTime("2026-09-12T08:00:00.000Z"),
  })
  .meta({ id: "Location", description: "A place a business sells WiFi" });

export const PublicVoucherSchema = z
  .object({
    id: f(z.string(), "vch_Zx81kQ0pLm"),
    status: f(z.enum(["active", "expired", "failed", "superseded"]), "active"),
    username: f(z.string(), "ada-4821", "The login name. The password is never available"),
    source: f(
      z.enum(["purchase", "generated"]),
      "purchase",
      'How it was issued: "purchase" for a sale through the platform, "generated" for a code the business printed and sold itself'
    ),
    customerUid: f(z.string().nullable(), "u_9fK2mP7qR1", 'Null when source is "generated"'),
    customerEmail: f(z.string().nullable(), "ada@example.com", 'Null when source is "generated"'),
    planId: f(z.string(), "pln_8Hq2LmZ0aB3c"),
    planName: f(z.string(), "Daily 5GB"),
    locationId: f(z.string(), "loc_3cD4eF5gH6"),
    duration: f(z.string(), "1 day"),
    dataLimit: f(z.string().nullable(), "5GB"),
    renewalOf: f(z.string().nullable(), null, "The voucher this renewal took over from"),
    paymentReference: f(
      z.string().nullable(),
      "hs_1761818400000_0123456789abcdef",
      'Null when source is "generated"'
    ),
    createdAt: isoTime(
      "2026-10-30T10:00:00.000Z",
      'ISO 8601 time, UTC. When it was sold, or for a generated code, when it was first used'
    ),
    expiresAt: isoTime("2026-10-31T10:05:00.000Z", "Null until the customer first logs in"),
  })
  .meta({ id: "Voucher", description: "A login sold to a customer" });

export const PublicPaymentSchema = z
  .object({
    reference: f(z.string(), "hs_1761818400000_0123456789abcdef", "The payment reference"),
    status: f(z.enum(["pending", "success", "failed"]), "success"),
    amountKobo: f(z.number().int(), 50750, "What the customer paid, in kobo"),
    tenantShareKobo: f(
      z.number().int().nullable(),
      45000,
      "The business's share, in kobo; null when the payment provider reported no split"
    ),
    customerUid: f(z.string(), "u_9fK2mP7qR1"),
    customerEmail: f(z.string(), "ada@example.com"),
    planId: f(z.string(), "pln_8Hq2LmZ0aB3c"),
    planName: f(z.string(), "Daily 5GB"),
    locationId: f(z.string(), "loc_3cD4eF5gH6"),
    voucherId: f(z.string().nullable(), "vch_Zx81kQ0pLm"),
    createdAt: isoTime("2026-10-30T10:00:00.000Z"),
  })
  .meta({ id: "Payment", description: "A customer's payment for a plan" });

export const PublicCustomerSchema = z
  .object({
    uid: f(z.string(), "u_9fK2mP7qR1"),
    email: f(z.string(), "ada@example.com"),
    externalId: f(
      z.string().nullable(),
      "MEMBER-0042",
      "The business's own id for this customer, from account linking"
    ),
    totalVouchers: f(z.number().int(), 7),
    totalSpentKobo: f(z.number().int(), 355250, "Lifetime spend, in kobo"),
    joinedAt: isoTime("2026-08-03T17:45:00.000Z"),
  })
  .meta({ id: "Customer", description: "Someone who has bought from the business" });

export type PublicVoucher = z.infer<typeof PublicVoucherSchema>;
export type PublicPayment = z.infer<typeof PublicPaymentSchema>;
