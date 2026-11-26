/**
 * Development refuses to start with live payment credentials (lib/dev-environment-guard.ts),
 * and runs against the live Firebase project as it always has.
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
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hotspot-mgt",
  FIREBASE_ADMIN_PROJECT_ID: "hotspot-mgt",
  KNOMAD_PAY_URL: "https://pay.staging.knomadhq.com",
  KNOMAD_PAY_API_KEY: "kp_test_x",
};
check("the live Firebase project with test payments starts", !throws(dev));
check("a live Knomad Pay key is refused", throws({ ...dev, KNOMAD_PAY_API_KEY: "kp_live_abc" }));
check("Knomad Pay production is refused", throws({ ...dev, KNOMAD_PAY_URL: "https://pay.knomadhq.com/" }));
check("every problem is named at once", productionTouchpoints({ KNOMAD_PAY_URL: "https://pay.knomadhq.com", KNOMAD_PAY_API_KEY: "kp_live_x" }).length === 2);
const warn = console.warn;
console.warn = () => {};
check("DEV_ALLOW_PRODUCTION=1 lets it start, loudly", !throws({ ...dev, KNOMAD_PAY_API_KEY: "kp_live_abc", DEV_ALLOW_PRODUCTION: "1" }));
console.warn = warn;
check("production itself is never stopped", !throws({ NODE_ENV: "production", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hotspot-mgt", KNOMAD_PAY_API_KEY: "kp_live_abc" }));

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
