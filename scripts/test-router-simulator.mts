/**
 * The simulated router behaves enough like RouterOS's REST API for fulfilment to run
 * end to end locally (lib/router-simulator.ts), and is never used in production.
 *
 * Run: npm run test:router-simulator
 */
import { resetSimulatedRouters, routerSimulated, simulateRouterRequest, simulatedRouterTable } from "../lib/router-simulator";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean) {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
const info = console.info;
console.info = () => {};

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "development";
env.ROUTER_MODE = "simulated";
check("on in development with ROUTER_MODE=simulated", routerSimulated());
env.NODE_ENV = "production";
check("never in production", !routerSimulated());
env.NODE_ENV = "development";

resetSimulatedRouters();
const ip = "10.8.0.2";
const created = simulateRouterRequest<{ ".id": string; name: string }>(ip, "PUT", "/ip/hotspot/user", { name: "v123", password: "p", profile: "daily" });
check("a user is created with an id", created.success && created.data[".id"] === "*1" && created.data.name === "v123");
const found = simulateRouterRequest<unknown[]>(ip, "GET", "/ip/hotspot/user?name=v123");
check("and found by name", found.success && (found.data as unknown[]).length === 1);
const other = simulateRouterRequest<unknown[]>(ip, "GET", "/ip/hotspot/user?name=nobody");
check("a name it lacks finds nothing", other.success && (other.data as unknown[]).length === 0);
simulateRouterRequest(ip, "PATCH", "/ip/hotspot/user/*1", { comment: "expires 2026-12-01" });
check("an update is kept", simulatedRouterTable(ip, "/ip/hotspot/user")[0]?.comment === "expires 2026-12-01");
simulateRouterRequest(ip, "POST", "/ip/hotspot/active/login", { user: "v123", ip: "10.5.50.7", "mac-address": "AA:BB" });
check("a device login shows as an active session", simulatedRouterTable(ip, "/ip/hotspot/active").length === 1);
simulateRouterRequest(ip, "DELETE", "/ip/hotspot/user/*1");
check("a delete removes it", simulatedRouterTable(ip, "/ip/hotspot/user").length === 0);
check("each router is separate", simulatedRouterTable("10.8.0.3", "/ip/hotspot/user").length === 0);
const missing = simulateRouterRequest(ip, "PATCH", "/ip/hotspot/user/*99", {});
check("an id it lacks is an error, as on a router", !missing.success);

console.info = info;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
