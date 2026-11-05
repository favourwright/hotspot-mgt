/**
 * Brings a tenant's routers onto the current expiry sweeper and removes the
 * global checker that predates it. See lib/router-expiry-scripts.ts for the
 * two defects this fixes.
 *
 * Driven from `/superadmin/config`, one tenant per request: router calls
 * time out at 8s each, so a whole-platform run in one request would outlive
 * the proxy in front of it. A dry run reads only, and is the default.
 *
 * Only the sweeper *script* is re-pushed. The profile's on-login script and
 * the scheduler's interval are unchanged by this fix, so touching them would
 * be a router write with nothing to gain.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  getSystemScriptSource,
  pushProfileExpiryScript,
  removeLegacyExpiryChecker,
  type LegacyExpiryCleanup,
} from "@/lib/mikrotik";
import { routerLogin } from "@/lib/router-credentials";
import {
  isCurrentProfileExpiryScript,
  profileExpiryScriptName,
} from "@/lib/router-expiry-scripts";

export type SweeperProfileStatus =
  | "current"
  | "outdated"
  | "missing"
  | "updated"
  | "failed";

export interface SweeperProfileReport {
  profile: string;
  status: SweeperProfileStatus;
  error?: string;
}

export interface SweeperRouterReport {
  routerId: string;
  routerName: string;
  reachable: boolean;
  error?: string;
  profiles: SweeperProfileReport[];
  legacy: LegacyExpiryCleanup | null;
}

export interface SweeperTenantReport {
  tenantId: string;
  applied: boolean;
  routers: SweeperRouterReport[];
}

/** Distinct MikroTik profiles of every plan sold through each router. */
async function profilesByRouter(tenantId: string): Promise<Map<string, Set<string>>> {
  const [locations, plans] = await Promise.all([
    adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).get(),
    adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).get(),
  ]);

  const routerOfLocation = new Map<string, string>();
  for (const doc of locations.docs) {
    const routerId = doc.data().routerId;
    if (typeof routerId === "string" && routerId) routerOfLocation.set(doc.id, routerId);
  }

  // Inactive plans too: a plan switched off still has customers on the
  // router under its profile, and their expiry still has to be enforced.
  const result = new Map<string, Set<string>>();
  for (const doc of plans.docs) {
    const data = doc.data();
    const routerId = routerOfLocation.get(data.locationId);
    const profile = data.mikrotikProfile;
    if (!routerId || typeof profile !== "string" || !profile) continue;
    if (!result.has(routerId)) result.set(routerId, new Set());
    result.get(routerId)!.add(profile);
  }
  return result;
}

export async function rolloutExpirySweeper(
  tenantId: string,
  options: { apply: boolean }
): Promise<SweeperTenantReport> {
  const routersSnap = await adminDb
    .collection(TENANT_COLLECTIONS.routers(tenantId))
    .get();
  const profiles = await profilesByRouter(tenantId);

  const routers: SweeperRouterReport[] = [];

  for (const doc of routersSnap.docs) {
    const data = doc.data();
    if (data.active === false) continue;

    const report: SweeperRouterReport = {
      routerId: doc.id,
      routerName: typeof data.name === "string" ? data.name : doc.id,
      reachable: true,
      profiles: [],
      legacy: null,
    };
    routers.push(report);

    let config;
    try {
      config = { ip: data.routerIp, ...routerLogin(data) };
    } catch (error) {
      report.reachable = false;
      report.error = error instanceof Error ? error.message : "Router credentials unavailable";
      continue;
    }

    const legacy = await removeLegacyExpiryChecker(config, { dryRun: !options.apply });
    if (!legacy.success) {
      // The first call to the router: failing here almost always means it
      // is offline, so nothing further is attempted on it.
      report.reachable = false;
      report.error = legacy.error;
      continue;
    }
    report.legacy = legacy.data ?? null;

    for (const profile of profiles.get(doc.id) ?? []) {
      const installed = await getSystemScriptSource(config, profileExpiryScriptName(profile));
      if (!installed.success) {
        report.profiles.push({ profile, status: "failed", error: installed.error });
        continue;
      }
      if (isCurrentProfileExpiryScript(profile, installed.data ?? undefined)) {
        report.profiles.push({ profile, status: "current" });
        continue;
      }
      const before: SweeperProfileStatus = installed.data ? "outdated" : "missing";
      // A profile with no sweeper at all was never set up through the plan
      // page; installing one here would also need its scheduler, which is
      // the owner's "push login script" action. Report it, do not create it.
      if (!options.apply || before === "missing") {
        report.profiles.push({ profile, status: before });
        continue;
      }
      // pushProfileExpiryScript ignores the duration arguments for the
      // script body; they only shape the scheduler, which is not touched.
      const pushed = await pushProfileExpiryScript(config, profile, 1, "h");
      report.profiles.push(
        pushed.success
          ? { profile, status: "updated" }
          : { profile, status: "failed", error: pushed.error }
      );
    }
  }

  return { tenantId, applied: options.apply, routers };
}

/** Tenants with at least one active router, for the rollout's tenant list. */
export async function tenantsWithRouters(): Promise<
  Array<{ tenantId: string; name: string; slug: string | null; routers: number }>
> {
  const routers = await adminDb.collectionGroup("routers").select("active").get();
  const counts = new Map<string, number>();
  for (const doc of routers.docs) {
    if (doc.data().active === false) continue;
    // A collection group also matches any top-level "routers"; only the
    // ones under a tenant count.
    const tenantId = doc.ref.parent.parent?.id;
    if (!tenantId || doc.ref.parent.parent?.parent.id !== COLLECTIONS.TENANTS) continue;
    counts.set(tenantId, (counts.get(tenantId) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const tenantRefs = [...counts.keys()].map((id) => adminDb.collection(COLLECTIONS.TENANTS).doc(id));
  const tenantDocs = await adminDb.getAll(...tenantRefs);
  return tenantDocs.map((doc) => ({
    tenantId: doc.id,
    name: (doc.get("businessName") as string | undefined) ?? doc.id,
    slug: (doc.get("slug") as string | undefined) ?? null,
    routers: counts.get(doc.id) ?? 0,
  }));
}
