/**
 * The SSRF guard on tenant-typed router addresses (lib/router-address.ts).
 *
 * Every refused case is somewhere a tenant could otherwise point this server:
 * loopback, the metadata service, the WireGuard manager, another product's
 * tunnel, or an alternate notation for one of those. The last section starts a
 * local server that redirects, proving a public "router" cannot bounce the
 * request somewhere the address check would have refused.
 *
 * Run: npm run test:router-address
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { routerAddressKind, routerAddressProblem } from "../lib/router-address";
import { testRouterConnection } from "../lib/mikrotik";

const refused = [
  "127.0.0.1", "127.0.0.1:51821", "0.0.0.0", "169.254.169.254", "192.168.1.1", "172.16.0.1",
  "10.0.0.1", "10.10.10.2", "10.20.1.1", "100.64.0.1", "224.0.0.1", "255.255.255.255",
  "0177.0.0.1", "2130706433", "0x7f.0.0.1", "127.1", "::1", "[::1]", "::ffff:127.0.0.1",
  "localhost", "metadata.google.internal", "router.example.com",
  "203.0.113.10/x", "203.0.113.10?a", "203.0.113.10#a", "user:pw@203.0.113.10", "203.0.113.10\\x",
  "169.254.169.254/opc/v1/instance/#", "8.8.8.8:0", "8.8.8.8:70000", "8.8.8.8:", " 8.8.8.8", "8.8.8.8 ",
  "", "256.1.1.1", "1.2.3", 42, null, undefined,
];
for (const raw of refused) {
  assert.equal(routerAddressKind(raw), null, `should refuse ${String(raw)}`);
}
console.log(`ok  ${refused.length} hostile or malformed addresses refused`);

assert.equal(routerAddressKind("8.8.8.8"), "public");
assert.equal(routerAddressKind("8.8.8.8:8728"), "public");
assert.equal(routerAddressKind("10.20.0.2"), "tunnel");
assert.equal(routerAddressKind("10.20.0.254:80"), "tunnel");
console.log("ok  public and tunnel addresses accepted");

assert.equal(routerAddressProblem("8.8.8.8", "direct"), null);
assert.equal(routerAddressProblem("10.20.0.2", "wireguard"), null);
assert.ok(routerAddressProblem("10.20.0.2", "direct"), "a direct router cannot claim the tunnel");
assert.ok(routerAddressProblem("8.8.8.8", "wireguard"), "a tunnel router cannot be public");
assert.ok(routerAddressProblem("192.168.1.1", "direct"));
console.log("ok  connection method has to match the address");

// The guard sits in front of the network, so a refused address never connects.
const blocked = await testRouterConnection({ ip: "127.0.0.1:9", username: "u", password: "p" });
assert.equal(blocked.success, false);
assert.match(blocked.error ?? "", /not allowed/i);
console.log("ok  mikrotikRequest refuses before connecting");

// A public address that answers with a redirect must not be followed. Loopback
// stands in for the attacker's server, reached through the test-only seam, and
// the target records whether it was ever called.
let targetHits = 0;
const target = http.createServer((_req, res) => {
  targetHits += 1;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ version: "leaked", uptime: "leaked" }));
});
await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
const targetPort = (target.address() as AddressInfo).port;

const redirector = http.createServer((_req, res) => {
  res.statusCode = 302;
  res.setHeader("Location", `http://127.0.0.1:${targetPort}/secret`);
  res.end();
});
await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
const redirectorPort = (redirector.address() as AddressInfo).port;

const { routerRequestForTest } = await import("../lib/mikrotik");
const bounced = await routerRequestForTest(`127.0.0.1:${redirectorPort}`);
assert.equal(bounced.success, false, "a redirect is a failure, not a followed request");
assert.equal(targetHits, 0, "the redirect target was never contacted");
console.log("ok  a redirect from a router is refused, not followed");

target.close();
redirector.close();
console.log("\nAll router address checks passed.");
