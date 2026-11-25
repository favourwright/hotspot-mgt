/**
 * Development refuses to start against production (lib/dev-environment-guard.ts).
 *
 * Run: npm run test:dev-guard
 */
import { guardDevelopmentEnvironment, productionTouchpoints } from "../lib/dev-environment-guard";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean) {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
const throws = (env: Record<string, string>) => {
  try {
    guardDevelopmentEnvironment(env);
    return false;
  } catch {
    return true;
  }
};

const dev = {
  NODE_ENV: "development",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "ogawifi-dev",
  FIREBASE_ADMIN_PROJECT_ID: "ogawifi-dev",
  KNOMAD_PAY_URL: "https://pay.staging.knomadhq.com",
  KNOMAD_PAY_API_KEY: "kp_test_x",
};
check("a development env that reaches nothing live starts", !throws(dev));
check("the production Firebase project is refused", throws({ ...dev, NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hotspot-mgt" }));
check("production Firebase admin credentials are refused", throws({ ...dev, FIREBASE_ADMIN_PROJECT_ID: "hotspot-mgt" }));
check("a live Paystack secret is refused", throws({ ...dev, PAYSTACK_SECRET_KEY: "sk_live_abc" }));
check("a live Paystack public key is refused", throws({ ...dev, NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_live_abc" }));
check("a live Knomad Pay key is refused", throws({ ...dev, KNOMAD_PAY_API_KEY: "kp_live_abc" }));
check("Knomad Pay production is refused", throws({ ...dev, KNOMAD_PAY_URL: "https://pay.knomadhq.com/" }));
check("test keys are fine", !throws({ ...dev, PAYSTACK_SECRET_KEY: "sk_test_abc" }));
check("every problem is named at once", productionTouchpoints({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hotspot-mgt", PAYSTACK_SECRET_KEY: "sk_live_x" }).length === 2);
const warn = console.warn;
console.warn = () => {};
check("DEV_ALLOW_PRODUCTION=1 lets it start, loudly", !throws({ ...dev, PAYSTACK_SECRET_KEY: "sk_live_abc", DEV_ALLOW_PRODUCTION: "1" }));
console.warn = warn;
check("production itself is never stopped", !throws({ NODE_ENV: "production", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hotspot-mgt", PAYSTACK_SECRET_KEY: "sk_live_abc" }));

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
