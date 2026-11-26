/**
 * Whether a payout account change goes through (lib/payout-account.ts), without the
 * network. A wrong answer either leaves a selling tenant with no payee, so every sale
 * is refused, or saves an account their bank does not recognise.
 *
 * Run: npm run test:payout-account
 */
import { decidePayoutChange } from "../lib/payout-account";
import type { PayoutDecision } from "../lib/payout-account";

let failed = 0;
let total = 0;
function check(name: string, got: PayoutDecision, want: { save: boolean; payeeReference?: string | null; status?: number }) {
  total += 1;
  const ok =
    got.save === want.save &&
    (got.save ? want.payeeReference === undefined || got.payeeReference === want.payeeReference : want.status === undefined || got.status === want.status);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`);
}
const bank = { code: "090267", name: "Kuda" };

check("payee made: switch to it", decidePayoutChange(true, { kind: "ready", reference: "tenant_t_new", created: true, bank }), { save: true, payeeReference: "tenant_t_new" });
check("payee made for a tenant with none: switch to it", decidePayoutChange(false, { kind: "ready", reference: "tenant_t", created: true, bank }), { save: true, payeeReference: "tenant_t" });
check("selling tenant, Monnify unavailable: keep the working payee", decidePayoutChange(true, { kind: "unavailable", detail: "x" }), { save: false, status: 503 });
check("selling tenant, Monnify refuses: keep the working payee", decidePayoutChange(true, { kind: "refused", detail: "x" }), { save: false, status: 503 });
check("no working payee, Monnify unavailable: save it for later", decidePayoutChange(false, { kind: "unavailable", detail: "x" }), { save: true, payeeReference: null });
check("no working payee, Monnify refuses: save it for later", decidePayoutChange(false, { kind: "refused", detail: "x" }), { save: true, payeeReference: null });
check("the bank names someone else: refused, either way", decidePayoutChange(false, { kind: "name_mismatch", bank, onRecord: "A", fromBank: "B" }), { save: false, status: 400 });
check("the account is not at that bank: refused", decidePayoutChange(true, { kind: "unresolvable", tried: [bank] }), { save: false, status: 400 });

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
