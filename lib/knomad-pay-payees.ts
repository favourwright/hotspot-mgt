/**
 * A tenant's payee at Knomad Pay: the Monnify sub-account their share of each voucher
 * sale is split to (lib/knomad-pay.ts, knomadPaySplit).
 *
 * Made from the bank details already on the tenant record. Those name the bank but not
 * its code, and Monnify's codes are its own (some differ from Paystack's), so the bank is
 * found in Monnify's list by name: an exact match after normalising, or a single
 * unambiguous partial one, never a guess. Then a name enquiry must name a holder who
 * agrees with the one on record, so a wrong match cannot pay a stranger. A tenant whose
 * bank cannot be matched is reported, to re-pick their bank in settings.
 */
import type { Bank } from "@favourwright/knomad-pay-client";
import { randomUUID } from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { knomadPay } from "@/lib/knomad-pay";
import type { Tenant } from "@/types/schemas";

const NOISE = /\b(plc|limited|ltd|bank|nigeria|nig|of|the|microfinance|mfb|mortgage|merchant|and|&)\b/g;

/** A bank name reduced to what tells banks apart. */
export function normaliseBankName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Banks whose names differ outright between the list a tenant picked from (Paystack's)
 * and Monnify's, by normalised stored name: Monnify's codes, most likely first.
 */
const ALIASES: Record<string, string[]> = {
  "guaranty trust": ["058"],
  "gtbank": ["058"],
  "access diamond": ["044", "063"],
  "opay digital services opay": ["999992", "305"],
  "opay": ["999992", "305"],
};

const MAX_CANDIDATES = 4;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The banks in Monnify's list the stored name could mean, most likely first. Monnify's
 * list names some banks twice under different codes (Kuda, Globus, OPay), so a name alone
 * cannot always choose; the name enquiry does (ensureTenantPayee tries each in turn).
 * Matching is strict: an alias, an exact normalised name, or the stored name as whole
 * words inside Monnify's (never the other way round, which matched "Guaranty Trust" to
 * "Trust Microfinance"). Empty when nothing fits.
 */
export function bankCandidates(storedName: string, banks: Bank[]): Bank[] {
  const want = normaliseBankName(storedName);
  if (!want) return [];
  const byCode = new Map(banks.map((b) => [b.code, b]));
  const found: Bank[] = [];
  const add = (b: Bank | undefined) => {
    if (b && !found.some((f) => f.code === b.code)) found.push(b);
  };
  for (const code of ALIASES[want] ?? []) add(byCode.get(code));
  for (const b of banks) if (normaliseBankName(b.name) === want) add(b);
  if (found.length === 0) {
    const whole = new RegExp(`(^| )${escapeRegExp(want)}( |$)`);
    for (const b of banks) if (whole.test(normaliseBankName(b.name))) add(b);
  }
  return found.slice(0, MAX_CANDIDATES);
}

/** Whether the holder a bank names is the one on record: their names share enough words. */
export function namesAgree(onRecord: string, fromBank: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length > 1));
  const a = words(onRecord);
  const b = words(fromBank);
  if (a.size === 0 || b.size === 0) return false;
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared >= Math.min(2, a.size, b.size);
}

export type PayeeOutcome =
  | { kind: "ready"; reference: string; created: boolean; bank?: Bank }
  | { kind: "no_bank_details" }
  | { kind: "bank_unmatched"; storedBank: string }
  | { kind: "name_mismatch"; bank: Bank; onRecord: string; fromBank: string }
  | { kind: "unresolvable"; tried: Bank[] }
  | { kind: "unavailable"; detail: string }
  | { kind: "refused"; detail: string };

/**
 * Makes sure the tenant has a payee at Knomad Pay, creating it from their bank details
 * if not. With `dryRun`, everything is checked and nothing is created or written.
 *
 * `reference` names the new payee (default `tenant_<id>`); a changed payout account needs
 * a fresh one, since the gateway keeps each reference for good. With `record: false` the
 * new reference is returned and not written to the tenant, for a caller that writes it
 * together with the bank details it was made from (lib/payout-account.ts).
 */
export async function ensureTenantPayee(
  tenant: Pick<Tenant, "id" | "businessName" | "ownerEmail" | "bankName" | "accountNumber" | "accountName" | "knomadPayeeReference"> &
    Partial<Pick<Tenant, "bankCode">>,
  options: { dryRun?: boolean; banks?: Bank[]; reference?: string; record?: boolean } = {}
): Promise<PayeeOutcome> {
  if (tenant.knomadPayeeReference) return { kind: "ready", reference: tenant.knomadPayeeReference, created: false };
  if (!tenant.bankName || !tenant.accountNumber || !tenant.accountName) return { kind: "no_bank_details" };

  const pay = knomadPay();
  let banks = options.banks;
  if (!banks) {
    const listed = await pay.listBanks();
    if (!listed.ok) return { kind: "unavailable", detail: `${listed.code} ${listed.message}` };
    banks = listed.data;
  }
  // A code chosen from Knomad Pay's own list at signup names the bank outright; older
  // tenants chose from Paystack's, whose codes differ, so theirs are matched by name.
  const byCode = tenant.bankCode ? banks.filter((b) => b.code === tenant.bankCode) : [];
  const candidates = byCode.length > 0 ? byCode : bankCandidates(tenant.bankName, banks);
  if (candidates.length === 0) return { kind: "bank_unmatched", storedBank: tenant.bankName };

  // The name enquiry decides between candidates: only the right bank names the holder.
  let bank: Bank | null = null;
  let mismatch: PayeeOutcome | null = null;
  for (const candidate of candidates) {
    const resolved = await pay.resolveAccount(
      { accountNumber: tenant.accountNumber, bankCode: candidate.code },
      { idempotencyKey: `resolve:${randomUUID()}` }
    );
    if (!resolved.ok) {
      if (resolved.code === "ACCOUNT_UNRESOLVABLE") continue;
      return { kind: "unavailable", detail: `${resolved.code} ${resolved.message}` };
    }
    if (namesAgree(tenant.accountName, resolved.data.accountName)) {
      bank = candidate;
      break;
    }
    mismatch ??= { kind: "name_mismatch", bank: candidate, onRecord: tenant.accountName, fromBank: resolved.data.accountName };
  }
  if (!bank) return mismatch ?? { kind: "unresolvable", tried: candidates };

  const reference = options.reference ?? `tenant_${tenant.id}`;
  if (options.dryRun) return { kind: "ready", reference, created: false, bank };

  const created = await pay.createPayee(
    { reference, name: tenant.businessName, email: tenant.ownerEmail, accountNumber: tenant.accountNumber, bankCode: bank.code },
    { idempotencyKey: `payee:${reference}:${randomUUID()}` }
  );
  if (!created.ok) {
    return created.status >= 500
      ? { kind: "unavailable", detail: `${created.code} ${created.message}` }
      : { kind: "refused", detail: `${created.code} ${created.message}` };
  }
  if (options.record !== false) {
    await adminDb.collection(COLLECTIONS.TENANTS).doc(tenant.id).update({ knomadPayeeReference: reference });
  }
  return { kind: "ready", reference, created: true, bank };
}
