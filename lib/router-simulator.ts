/**
 * A simulated MikroTik router, for local development only (ROUTER_MODE=simulated).
 *
 * Every router call goes through `routerFetch` (lib/mikrotik.ts), RouterOS's REST API,
 * whose shape is regular: tables (`/ip/hotspot/user`, `/system/scheduler`, …) that are
 * listed, filtered by `?field=value`, created with PUT, changed with PATCH and removed
 * with DELETE by `.id`, plus a few commands (POST). This answers those from memory, per
 * router address, and logs each call, so a voucher can be fulfilled end to end on a
 * laptop: the step that otherwise only ever ran in production.
 *
 * Never used in production, whatever the env says (see `routerSimulated`).
 */

type Row = Record<string, unknown> & { ".id": string };

const TABLES = [
  "/ip/hotspot/user/profile",
  "/ip/hotspot/user",
  "/ip/hotspot/active",
  "/ip/hotspot/profile",
  "/ip/hotspot/walled-garden",
  "/system/scheduler",
  "/system/script",
  "/file",
];

const routers = new Map<string, { tables: Map<string, Row[]>; nextId: number }>();

export function routerSimulated(): boolean {
  return process.env.ROUTER_MODE === "simulated" && process.env.NODE_ENV !== "production";
}

/** For tests: forget every simulated router. */
export function resetSimulatedRouters(): void {
  routers.clear();
}

/** What a simulated router holds now, for tests and for looking at by hand. */
export function simulatedRouterTable(ip: string, table: string): Row[] {
  return [...(routers.get(ip)?.tables.get(table) ?? [])];
}

export function simulateRouterRequest<T>(
  ip: string,
  method: "GET" | "PUT" | "PATCH" | "DELETE" | "POST",
  pathWithQuery: string,
  body?: Record<string, unknown>
): { success: true; data: T } | { success: false; error: string } {
  const router = routers.get(ip) ?? { tables: new Map<string, Row[]>(), nextId: 1 };
  routers.set(ip, router);
  const [path, query = ""] = pathWithQuery.split("?");
  console.info(`[router-sim ${ip}] ${method} ${pathWithQuery}${body ? ` ${JSON.stringify(body)}` : ""}`);

  if (path === "/system/resource") {
    return { success: true, data: { uptime: "1d", version: "7.16 (simulated)", "board-name": "simulated", "cpu-load": "1" } as T };
  }
  const table = TABLES.find((t) => path === t || path!.startsWith(`${t}/`));
  if (!table) {
    // Commands with no table behind them (/tool/fetch, …): done, nothing to report.
    return { success: true, data: (method === "GET" ? [] : {}) as T };
  }
  const rows = router.tables.get(table) ?? [];
  router.tables.set(table, rows);
  const rest = path!.slice(table.length + 1);

  if (rest && !rest.startsWith("*")) {
    // A command on the table, such as /ip/hotspot/active/login or reset-counters.
    if (table === "/ip/hotspot/active" && rest === "login" && body?.user) {
      rows.push({ ".id": `*${router.nextId++}`, user: body.user, address: body.ip ?? "", "mac-address": body["mac-address"] ?? "" });
    }
    return { success: true, data: [] as T };
  }

  if (!rest) {
    if (method === "GET") {
      const filters = new URLSearchParams(query);
      const matching = rows.filter((row) =>
        [...filters].every(([k, v]) => k.startsWith(".") || String(row[k] ?? "") === v)
      );
      return { success: true, data: matching as T };
    }
    if (method === "PUT") {
      const row: Row = { ...(body ?? {}), ".id": `*${router.nextId++}` };
      rows.push(row);
      return { success: true, data: row as unknown as T };
    }
    return { success: true, data: {} as T };
  }

  const id = rest;
  const index = rows.findIndex((row) => row[".id"] === id);
  if (index === -1) return { success: false, error: "no such item" };
  if (method === "GET") return { success: true, data: rows[index] as unknown as T };
  if (method === "PATCH") {
    rows[index] = { ...rows[index]!, ...(body ?? {}), ".id": id };
    return { success: true, data: rows[index] as unknown as T };
  }
  if (method === "DELETE") {
    rows.splice(index, 1);
    return { success: true, data: undefined as T };
  }
  return { success: true, data: {} as T };
}
