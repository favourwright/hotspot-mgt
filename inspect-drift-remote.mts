/**
 * Read-only. Prints what the admin Users page sees for WashingtonLodge,
 * from inside the WireGuard tunnel. Writes nothing. Delete after use.
 */
import { loadScriptEnv } from "./scripts/load-env.mts";
loadScriptEnv();
const { getMergedHotspotUsers } = await import("./lib/hotspot-users");

console.log("TZ env:", process.env.TZ ?? "(unset)");
console.log("local now:", new Date().toString());
console.log("offset minutes:", -new Date().getTimezoneOffset());

const res = await getMergedHotspotUsers("dlVEslgcLRbNc7ohvNm0", "bIOx7C7jAXFpcppzZZ1M");
if (!res) { console.log("no router for location"); process.exit(0); }
console.log("reachable:", res.routerReachable, res.routerError ?? "");
console.log("counts:", JSON.stringify(res.counts));

for (const u of res.users) {
  if (u.drift) console.log("\nDRIFT ROW " + JSON.stringify(u, null, 2));
}

console.log("\n--- every row ---");
console.table(res.users.map((u) => ({
  user: u.username, src: u.source, status: u.status, voucher: u.voucherStatus,
  plan: u.planName, comment: u.comment, limitUptime: u.limitUptime,
  disabled: u.disabledOnRouter, expiresAt: u.expiresAt, expirySource: u.expirySource,
})));
process.exit(0);
