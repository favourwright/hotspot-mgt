/**
 * Gives every tunnel router that predates the peer ledger its `wgPeers`
 * record (lib/wg-peers.ts), so its address is known to be taken and can be
 * given back when the router is deleted.
 *
 *   npm run wg-peers:backfill            # dry run: lists what it would write
 *   npm run wg-peers:backfill -- --apply # writes the records
 *
 * Run it once, before or straight after the deploy that adds the ledger.
 * Until it has run, provision treats a key the VPS already knows and the
 * ledger does not as an abandoned peer of ours, which for a router already
 * registered on another tenant would be the wrong answer.
 *
 * It does not touch the VPS. Peers on wg0 with no router at all (the leak this
 * ledger closes) are listed by comparing its output with `wg show wg0
 * allowed-ips` on the VPS; see docs/router-and-wireguard.md.
 *
 * Talks to the live Firebase project, like every maintenance script.
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS, TENANT_COLLECTIONS } = await import("../lib/firebase-collections");
const { peerId, isOurTunnelAddress } = await import("../lib/wg-peers");

const apply = process.argv.includes("--apply");

let written = 0;
let present = 0;
const problems: string[] = [];

for (const tenant of (await adminDb.collection(COLLECTIONS.TENANTS).get()).docs) {
  const routers = await adminDb
    .collection(TENANT_COLLECTIONS.routers(tenant.id))
    .where("connectionMethod", "==", "wireguard")
    .get();
  for (const router of routers.docs) {
    const publicKey = (router.get("wireguardPublicKey") as string | null)?.trim();
    const ip = ((router.get("wireguardTunnelIp") as string | null) ?? String(router.get("routerIp") ?? "")).split(":")[0];
    const label = `${tenant.get("slug")}/${router.id} (${router.get("name") ?? "unnamed"})`;
    if (!publicKey) {
      problems.push(`${label}: tunnel router with no public key on record`);
      continue;
    }
    if (!isOurTunnelAddress(ip)) {
      problems.push(`${label}: ${ip} is outside the tunnel subnet`);
      continue;
    }
    const ref = adminDb.collection(COLLECTIONS.WG_PEERS).doc(peerId(publicKey));
    const existing = await ref.get();
    if (existing.exists) {
      present += 1;
      if (existing.get("tenantId") !== tenant.id || existing.get("routerId") !== router.id) {
        problems.push(`${label}: key already recorded for ${existing.get("tenantId")}/${existing.get("routerId")}`);
      }
      continue;
    }
    console.log(`${apply ? "write" : "would write"} ${label} -> ${ip}`);
    if (apply) {
      await ref.create({
        tenantId: tenant.id,
        publicKey,
        assignedIp: ip,
        routerId: router.id,
        releasedAt: null,
        createdAt: router.get("createdAt") ?? new Date(),
        backfilled: true,
      });
    }
    written += 1;
  }
}

console.log(`\n${apply ? "Wrote" : "Would write"} ${written}; ${present} already recorded.`);
for (const p of problems) console.log(`  ! ${p}`);
if (!apply && written > 0) console.log("Dry run. Re-run with --apply to write.");
process.exit(problems.length > 0 ? 1 : 0);
