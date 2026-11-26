/**
 * What /api/v1 returns for each resource, field by field.
 *
 * Deliberately explicit. A serializer that spread the stored document would
 * publish every field added to it later, so a new internal field (a router
 * credential, a subaccount code) would leak the day it was introduced. Here
 * a field is public only once somebody writes it into this file.
 *
 * Never returned: voucher passwords, device MAC addresses, router IPs and
 * credentials, payee references, the platform's share of a sale.
 *
 * Money is integer kobo, named `...Kobo`. Times are ISO 8601 in UTC; the
 * Africa/Lagos formatting in lib/utils.ts is for screens, not for machines.
 */

import type { Location, Payment, Plan, TenantCustomer, Voucher } from "@/types/schemas";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function publicPlan(p: Plan) {
  return {
    id: p.id,
    name: p.name,
    priceKobo: p.price,
    duration: p.duration,
    dataLimit: p.dataLimit ?? null,
    devices: p.sharedUsers ?? null,
    locationId: p.locationId,
    active: p.active,
    createdAt: iso(p.createdAt),
  };
}

export function publicLocation(l: Location) {
  return {
    id: l.id,
    name: l.name,
    active: l.active,
    createdAt: iso(l.createdAt),
  };
}

export function publicVoucher(v: Voucher) {
  return {
    id: v.id,
    status: v.status,
    // The login name is what a customer reads to support; the password
    // never leaves the platform through the API.
    username: v.username,
    // The schema's own default, repeated so a voucher built without going
    // through parseVoucher still says what every pre-generation one was.
    source: v.source ?? "purchase",
    customerUid: v.userId,
    customerEmail: v.userEmail,
    planId: v.planId,
    planName: v.planName,
    locationId: v.locationId,
    duration: v.duration,
    dataLimit: v.dataLimit ?? null,
    renewalOf: v.renewalOf ?? null,
    // A generated code was never paid for through us: no reference to give.
    paymentReference: v.source === "generated" ? null : v.reference ?? null,
    createdAt: iso(v.createdAt),
    expiresAt: iso(v.expiresAt ?? null),
  };
}

export function publicPayment(p: Payment) {
  return {
    reference: p.reference,
    status: p.status,
    amountKobo: p.amount,
    // The tenant's own share, which is theirs to know. Null means the split
    // is not known (an old sale with none reported): unknown, not zero.
    tenantShareKobo: p.tenantShareKobo ?? null,
    customerUid: p.userId,
    customerEmail: p.userEmail,
    planId: p.planId,
    planName: p.planName,
    locationId: p.locationId,
    voucherId: p.voucherId ?? null,
    createdAt: iso(p.createdAt),
  };
}

export function publicCustomer(c: TenantCustomer, externalId: string | null = null) {
  return {
    uid: c.uid,
    email: c.email,
    // The tenant's own id for this customer, from account linking.
    externalId,
    totalVouchers: c.totalVouchers,
    totalSpentKobo: c.totalSpent,
    joinedAt: iso(c.joinedAt),
  };
}
