import { routerLogin } from "@/lib/router-credentials";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { RouterConfig } from "@/lib/mikrotik";

/**
 * Resolves a location to the router behind it, with its credentials.
 *
 * Why this is cached at all: resolving a location costs two Firestore reads
 * (the location document, then the router it points at). Anything that polls
 * the router pays that on every tick - a 15s poll from one open tab is ~480
 * reads an hour, which is how a dashboard quietly exhausts a daily quota.
 * Cached, polling costs no Firestore reads at all.
 *
 * Why an in-process Map rather than unstable_cache: this value contains the
 * router's password. Next's data cache persists to .next/cache on disk, and
 * credentials don't belong there. This stays in memory, dies with the
 * process, and is plenty - the app runs as a single long-lived server.
 */
export interface ResolvedRouter {
  config: RouterConfig;
  routerId: string;
  routerName: string;
  locationName: string;
}

const TTL_MS = 5 * 60 * 1000;

interface Entry {
  value: ResolvedRouter | null;
  expiresAt: number;
}

const entries = new Map<string, Entry>();
// Concurrent misses for the same location share one Firestore lookup rather
// than each firing their own - several viewers opening the same page at once
// is the normal case, not the exception.
const inFlight = new Map<string, Promise<ResolvedRouter | null>>();

function keyFor(tenantId: string, locationId: string): string {
  return `${tenantId}:${locationId}`;
}

async function resolve(
  tenantId: string,
  locationId: string
): Promise<ResolvedRouter | null> {
  const locationDoc = await adminDb
    .collection(TENANT_COLLECTIONS.locations(tenantId))
    .doc(locationId)
    .get();

  const locationData = locationDoc.data();
  if (!locationDoc.exists || !locationData?.routerId) return null;

  const routerDoc = await adminDb
    .collection(TENANT_COLLECTIONS.routers(tenantId))
    .doc(locationData.routerId)
    .get();

  const routerData = routerDoc.data();
  if (!routerDoc.exists || !routerData) return null;

  return {
    config: {
      ip: routerData.routerIp,
      ...routerLogin(routerData),
    },
    routerId: locationData.routerId,
    routerName: routerData.name ?? "Router",
    locationName: locationData.name ?? "Location",
  };
}

export async function getRouterForLocation(
  tenantId: string,
  locationId: string
): Promise<ResolvedRouter | null> {
  const key = keyFor(tenantId, locationId);

  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = resolve(tenantId, locationId)
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Call after a router's address or credentials change, or after a location
 * is repointed at a different router. Without a locationId, clears every
 * entry for the tenant - the cheap, correct choice when a router changed and
 * you don't want to work out which locations use it.
 */
export function invalidateRouterCache(
  tenantId: string,
  locationId?: string
): void {
  if (locationId) {
    entries.delete(keyFor(tenantId, locationId));
    return;
  }
  for (const key of entries.keys()) {
    if (key.startsWith(`${tenantId}:`)) entries.delete(key);
  }
}
