/**
 * A tenant changing the bank account their share of each voucher sale is paid into.
 *
 * Their money follows this, so the order is the safe one. The new account is named by
 * its bank (a name enquiry through Knomad Pay), then its payee is made, and only then
 * does the tenant switch to it, bank details and payee together. A tenant who is
 * selling keeps their working payee until the new one exists: a change Monnify cannot
 * take right now is refused rather than leaving them with none, which would refuse
 * every sale. A tenant with no working payee (one whose bank could not be matched, or
 * waiting on Monnify) has the new details saved regardless, and the payee is made then
 * or by the reconcile cron.
 *
 * The owner is emailed whenever it changes, since a payout account quietly changed is
 * how a tenant's money would be taken.
 */
import { randomUUID } from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { knomadPay } from "@/lib/knomad-pay";
import { ensureTenantPayee, type PayeeOutcome } from "@/lib/knomad-pay-payees";
import { invalidateTenant } from "@/lib/tenant-cache";
import { notifyPayoutAccountChanged } from "@/lib/notifications";

export type PayoutDecision =
  | { save: true; payeeReference: string | null }
  | { save: false; error: string; status: number };

/**
 * Whether a change goes through, from whether the tenant has a working payee and what
 * making the new one gave. Pure, for `npm run test:payout-account`.
 */
export function decidePayoutChange(hasWorkingPayee: boolean, outcome: PayeeOutcome): PayoutDecision {
  if (outcome.kind === "ready") return { save: true, payeeReference: outcome.reference };
  if (outcome.kind === "name_mismatch") {
    return { save: false, status: 400, error: "The bank names a different account holder. Check the account number and bank." };
  }
  if (outcome.kind === "unresolvable" || outcome.kind === "bank_unmatched" || outcome.kind === "no_bank_details") {
    return { save: false, status: 400, error: "We couldn't find that account at that bank. Check the account number and bank." };
  }
  // Monnify unreachable, or not taking it now. A tenant with nothing working loses
  // nothing by saving it for later; one who is selling keeps what works.
  if (!hasWorkingPayee) return { save: true, payeeReference: null };
  return {
    save: false,
    status: 503,
    error: "We couldn't set up the new account just now, so your payouts still go to the current one. Please try again later.",
  };
}

export async function changePayoutAccount(input: {
  tenantId: string;
  bankCode: string;
  accountNumber: string;
}): Promise<{ ok: true; payeeReady: boolean; accountName: string; bankName: string } | { ok: false; status: number; error: string }> {
  const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc(input.tenantId);
  const tenant = (await tenantRef.get()).data();
  if (!tenant) return { ok: false, status: 404, error: "Tenant not found" };

  const pay = knomadPay();
  const listed = await pay.listBanks();
  if (!listed.ok) return { ok: false, status: 502, error: "We couldn't load the bank list just now. Please try again." };
  const bank = listed.data.find((b) => b.code === input.bankCode);
  if (!bank) return { ok: false, status: 400, error: "Choose your bank from the list." };

  // Named by the bank: the holder's name on record is the bank's, never typed in.
  const resolved = await pay.resolveAccount(
    { accountNumber: input.accountNumber, bankCode: bank.code },
    { idempotencyKey: `resolve:${randomUUID()}` }
  );
  if (!resolved.ok) {
    return resolved.code === "ACCOUNT_UNRESOLVABLE"
      ? { ok: false, status: 400, error: "We couldn't find that account at that bank. Check the account number and bank." }
      : { ok: false, status: 502, error: "We couldn't check the account just now. Please try again." };
  }
  const accountName = resolved.data.accountName;
  if (tenant.accountNumber === input.accountNumber && tenant.bankCode === bank.code && tenant.knomadPayeeReference) {
    return { ok: true, payeeReady: true, accountName, bankName: bank.name };
  }

  const hasWorkingPayee = Boolean(tenant.knomadPayeeReference);
  // The gateway keeps every reference for good, so a payee replacing one needs its own.
  const reference = hasWorkingPayee ? `tenant_${input.tenantId}_${Date.now().toString(36)}` : `tenant_${input.tenantId}`;
  const outcome = await ensureTenantPayee(
    {
      id: input.tenantId,
      businessName: tenant.businessName,
      ownerEmail: tenant.ownerEmail,
      bankName: bank.name,
      bankCode: bank.code,
      accountNumber: input.accountNumber,
      accountName,
      knomadPayeeReference: null,
    },
    { banks: listed.data, reference, record: false }
  );
  const decision = decidePayoutChange(hasWorkingPayee, outcome);
  if (!decision.save) return { ok: false, status: decision.status, error: decision.error };

  await tenantRef.update({
    bankName: bank.name,
    bankCode: bank.code,
    accountNumber: input.accountNumber,
    accountName,
    knomadPayeeReference: decision.payeeReference,
    updatedAt: new Date(),
  });
  invalidateTenant(tenant.slug);
  console.info(`[payout] ${tenant.slug} changed payout account; payee ${decision.payeeReference ?? "pending"}`);
  await notifyPayoutAccountChanged({
    tenantId: input.tenantId,
    bankName: bank.name,
    accountLast4: input.accountNumber.slice(-4),
  }).catch((error) => console.error(`[payout] notice for ${tenant.slug} not sent:`, error));
  return { ok: true, payeeReady: decision.payeeReference !== null, accountName, bankName: bank.name };
}
