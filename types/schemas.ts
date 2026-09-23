import { z } from "zod";

/**
 * Zod schemas are the single source of truth for all data types.
 * TypeScript types are automatically inferred from these schemas.
 * 
 * Benefits:
 * - Change schema once, types update everywhere
 * - Runtime validation catches data corruption
 * - Self-documenting
 * - Used for both API input validation and Firestore reads
 */

// User Schema
export const UserSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  role: z.enum(["customer", "admin"]),
  createdAt: z.date(),
});

// Location (MikroTik Router) Schema
export const LocationSchema = z.object({
  id: z.string(),
  name: z.string().min(2),
  routerIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Invalid IP address"),
  routerUser: z.string().min(1),
  routerPass: z.string().min(1),
  active: z.boolean(),
  createdAt: z.date(),
});

// Plan Schema
export const PlanSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  name: z.string().min(1),
  price: z.number().int().positive(), // price in kobo
  duration: z.string(),
  dataLimit: z.string(),
  mikrotikProfile: z.string().min(1),
  active: z.boolean(),
  createdAt: z.date(),
});

// Voucher Schema
export const VoucherSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().email(),
  planId: z.string(),
  planName: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  username: z.string(),
  password: z.string(),
  duration: z.string(),
  dataLimit: z.string().optional(),
  status: z.enum(["active", "expired", "failed"]),
  paystackReference: z.string().default(""), // Made optional with default
  failureReason: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0), // Made optional with default
  lastRetryAt: z.date().optional().nullable(),
  createdAt: z.date(),
  expiresAt: z.date().nullable().default(null), // Made nullable with default
});

// Payment Schema
export const PaymentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().email(),
  planId: z.string(),
  planName: z.string(),
  locationId: z.string(),
  amount: z.number().int().positive(), // amount in kobo
  paystackReference: z.string(),
  status: z.enum(["pending", "success", "failed"]),
  voucherId: z.string().optional(),
  createdAt: z.date(),
});

// MikroTik Hotspot User Schema
export const MikrotikHotspotUserSchema = z.object({
  name: z.string(),
  password: z.string(),
  profile: z.string(),
  comment: z.string().optional(),
});

// MikroTik Hotspot Profile Schema
export const MikrotikProfileSchema = z.object({
  ".id": z.string(),
  name: z.string(),
  "rate-limit": z.string().optional(),
  "session-timeout": z.string().optional(),
  "shared-users": z.string().optional(),
  "keepalive-timeout": z.string().optional(),
  "status-autorefresh": z.string().optional(),
  "idle-timeout": z.string().optional(),
  "transparent-proxy": z.string().optional(),
});

// API Response Schema
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
  });

// Infer TypeScript types from schemas
export type User = z.infer<typeof UserSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Voucher = z.infer<typeof VoucherSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type MikrotikHotspotUser = z.infer<typeof MikrotikHotspotUserSchema>;
export type MikrotikProfile = z.infer<typeof MikrotikProfileSchema>;
export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};
