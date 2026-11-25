/**
 * Tenants' payees at Knomad Pay, from the bank details on their records.
 *
 * Getting this wrong pays a tenant's share to someone else, so the bank is matched
 * strictly against Monnify's real list (scripts/fixtures/monnify-banks.json, read from
 * Knomad Pay staging) and the name enquiry must name the holder on record. The case that
 * started this: a loose match sent "Guaranty Trust Bank" to "Trust Microfinance Bank".
 *
 * Run: npm run test:knomad-pay-payees
 */
import { readFileSync } from "fs";
import { createKnomadPayClient } from "@favourwright/knomad-pay-client";
import { useKnomadPayClient } from "../lib/knomad-pay";
import { bankCandidates, ensureTenantPayee, namesAgree } from "../lib/knomad-pay-payees";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean, detail = "") {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
}

const banks = JSON.parse(readFileSync(new URL("./fixtures/monnify-banks.json", import.meta.url), "utf8"));
const codes = (name: string) => bankCandidates(name, banks).map((b) => b.code);

// 1. Matching, against Monnify's own list.
const expect: [string, string[]][] = [
  ["Guaranty Trust Bank", ["058"]],
  ["Access Bank", ["044"]],
  ["Access Bank (Diamond)", ["044", "063"]],
  ["First Bank of Nigeria", ["011"]],
  ["United Bank For Africa", ["033"]],
  ["Zenith Bank", ["057"]],
  ["Moniepoint MFB", ["50515"]],
  ["OPay Digital Services Limited (OPay)", ["999992", "305"]],
  ["PalmPay", ["100033"]],
  ["Wema Bank", ["035"]],
];
for (const [name, want] of expect) {
  check(`"${name}" -> ${want.join(", ")}`, JSON.stringify(codes(name)) === JSON.stringify(want), `got ${codes(name).join(", ")}`);
}
check('"Guaranty Trust Bank" never matches Trust Microfinance Bank', !codes("Guaranty Trust Bank").includes("090327"));
check("a bank listed twice gives both codes, for the name check to choose", codes("Kuda Bank").length === 2 && codes("Globus Bank").length === 2);
check("an unknown bank matches nothing", codes("Bank of Atlantis").length === 0);
check("no name, no match", codes("").length === 0 && codes("Bank").length === 0);

// 2. The holder on record against the name a bank gives.
check("same holder, other order and case", namesAgree("Ada Okafor Stores", "OKAFOR ADA"));
check("one shared word is not enough for a long name", !namesAgree("Ada Okafor", "ADA NWOSU"));
check("a single-word name matches itself", namesAgree("Okafor", "OKAFOR"));
check("nothing on record agrees with nothing", !namesAgree("", "ADA OKAFOR"));

// 3. ensureTenantPayee, dry run, against a stand-in for Knomad Pay.
function gateway(resolveByCode: Record<string, { name?: string } | "unresolvable">) {
  const fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v1/banks/resolve") {
      const { bankCode, accountNumber } = JSON.parse(String(init?.body));
      const answer = resolveByCode[bankCode];
      if (!answer || answer === "unresolvable") {
        return new Response(JSON.stringify({ data: null, error: { code: "ACCOUNT_UNRESOLVABLE", message: "no" } }), { status: 422 });
      }
      return new Response(JSON.stringify({ data: { accountName: answer.name, accountNumber, bankCode }, error: null }));
    }
    return new Response(JSON.stringify({ data: null, error: { code: "NOT_FOUND", message: path } }), { status: 404 });
  }) as typeof globalThis.fetch;
  useKnomadPayClient(createKnomadPayClient({ baseUrl: "https://pay.example", apiKey: "kp_test_x", fetch }));
}
const tenant = {
  id: "t1",
  businessName: "Ada Wifi",
  ownerEmail: "ada@example.com",
  bankName: "Kuda Bank",
  accountNumber: "0123456789",
  accountName: "Ada Okafor",
  knomadPayeeReference: null,
};

gateway({ "090267": "unresolvable", "50211": { name: "OKAFOR ADA" } });
let outcome = await ensureTenantPayee(tenant, { dryRun: true, banks });
check("the name check picks the right one of two codes", outcome.kind === "ready" && outcome.bank?.code === "50211" && outcome.reference === "tenant_t1", JSON.stringify(outcome));

gateway({ "090267": { name: "SOMEONE ELSE ENTIRELY" }, "50211": "unresolvable" });
outcome = await ensureTenantPayee(tenant, { dryRun: true, banks });
check("a bank that names someone else is a mismatch, not a payee", outcome.kind === "name_mismatch", JSON.stringify(outcome));

gateway({});
outcome = await ensureTenantPayee(tenant, { dryRun: true, banks });
check("no candidate resolving is unresolvable", outcome.kind === "unresolvable");

outcome = await ensureTenantPayee({ ...tenant, bankName: "Bank of Atlantis" }, { dryRun: true, banks });
check("an unknown bank is reported to re-pick", outcome.kind === "bank_unmatched");

outcome = await ensureTenantPayee({ ...tenant, accountNumber: null }, { dryRun: true, banks });
check("no bank details on record", outcome.kind === "no_bank_details");

outcome = await ensureTenantPayee({ ...tenant, knomadPayeeReference: "tenant_t1" }, { dryRun: true, banks });
check("a tenant with a payee already is left as it is", outcome.kind === "ready" && outcome.created === false);

useKnomadPayClient(null);
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
