/**
 * Keeping a decision hook's verification page reachable from the captive
 * portal.
 *
 * A customer buying from behind the hotspot has no internet until they pay,
 * so "Verify your account" sends them to a host their own router blocks,
 * unless that host is in the walled garden. This puts it there, and keeps it
 * in step:
 *
 *  - installing or reinstalling the portal adds it, after the platform's
 *    own hosts (app/api/admin/locations/[id]/install-portal);
 *  - an owner saving a new verification page, or deleting the hook, swaps
 *    it on every router whose location has the portal installed.
 *
 * The entry carries its own comment (`WALLED_GARDEN_HOOK_COMMENT`), so a
 * swap never touches the portal's entries, and uninstall withdraws it with
 * the rest (`removeOurWalledGardenEntries`), which keeps the restore
 * contract in docs/captive-portal.md.
 *
 * Best effort per router: an offline router is named in the result rather
 * than failing the save. The next reinstall, or the next save, catches it up.
 */

import { routerLogin } from "@/lib/router-credentials";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  WALLED_GARDEN_HOOK_COMMENT,
  syncWalledGardenComment,
  type RouterConfig,
} from "@/lib/mikrotik";
import { invalidateTenantHooks, listTenantHooks } from "@/lib/decision-hooks";

export interface HookGardenSync {
  at: string;
  host: string | null;
  /** Routers with the portal installed that now match. */
  synced: number;
  /** Locations whose router could not be updated. */
  failed: string[];
}

/** The verification page's host, if the tenant's hook has one. */
export async function hookGardenHost(tenantId: string): Promise<string | null> {
  const hook = (await listTenantHooks(tenantId)).find((h) => h.linkUrl);
  if (!hook?.linkUrl) return null;
  try {
    return new URL(hook.linkUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** One router: exactly this host under our hook comment, or none. */
export function syncRouterHookGarden(config: RouterConfig, host: string | null) {
  return syncWalledGardenComment(config, WALLED_GARDEN_HOOK_COMMENT, host ? [host] : []);
}

/**
 * Every router whose location has the portal installed, then the outcome
 * stamped on the tenant's hook for the hooks page. Run in the background:
 * it talks to routers, which can take seconds each.
 */
export async function syncTenantHookGarden(tenantId: string): Promise<HookGardenSync> {
  const host = await hookGardenHost(tenantId);

  const locations = await adminDb
    .collection(TENANT_COLLECTIONS.locations(tenantId))
    .limit(200)
    .get();
  const installed = locations.docs.filter((d) => d.data().portalInstalledAt);

  let synced = 0;
  const failed: string[] = [];
  for (const location of installed) {
    const name = (location.data().name as string) || location.id;
    const routerId = location.data().routerId as string | undefined;
    const router = routerId
      ? await adminDb.collection(TENANT_COLLECTIONS.routers(tenantId)).doc(routerId).get()
      : null;
    const r = router?.data();
    if (!r) {
      failed.push(name);
      continue;
    }
    let login: ReturnType<typeof routerLogin>;
    try {
      login = routerLogin(r);
    } catch (error) {
      failed.push(name);
      console.warn(`[hooks] walled garden sync skipped for ${name}: ${String(error)}`);
      continue;
    }
    // The same address the portal install uses to reach this router.
    const result = await syncRouterHookGarden(
      { ip: r.wireguardTunnelIp || r.routerIp, ...login },
      host
    );
    if (result.success) synced += 1;
    else {
      failed.push(name);
      console.warn(`[hooks] walled garden sync failed for ${name}: ${result.error}`);
    }
  }

  const outcome: HookGardenSync = { at: new Date().toISOString(), host, synced, failed };
  const hooks = await adminDb.collection(TENANT_COLLECTIONS.hooks(tenantId)).limit(20).get();
  await Promise.all(hooks.docs.map((d) => d.ref.update({ walledGardenSync: outcome })));
  invalidateTenantHooks(tenantId);
  return outcome;
}

/** Scheduling helper for the hook routes: never throws into a request. */
export function syncTenantHookGardenLater(
  tenantId: string,
  defer: (task: () => Promise<void>) => void
): void {
  defer(async () => {
    try {
      await syncTenantHookGarden(tenantId);
    } catch (error) {
      console.error(`[hooks] walled garden sync crashed for ${tenantId}:`, error);
    }
  });
}
