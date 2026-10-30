/**
 * The developer docs cannot drift from the API.
 *
 * The docs are generated from the code (lib/openapi.ts), so most drift is
 * impossible by construction. What is left is the edges, and each case here
 * is one: a route nobody declared, so it is live and undocumented. A
 * generated index left stale. An error code thrown that the error table does
 * not list, so a developer meets a code the docs never mentioned. A
 * reference to a schema that is not in the document.
 *
 * Run: npm run test:api-docs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const { buildOpenApiDocument } = await import("../lib/openapi");
const { API_ROUTES } = await import("../lib/generated/api-routes");
const { ERROR_CATALOG } = await import("../lib/public-api");
const { API_SCOPES } = await import("../lib/api-keys");
const { WEBHOOK_EVENT_TYPES } = await import("../lib/webhook-events");
const { HOOK_EVENT } = await import("../lib/decision-hook-contract");

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(68)} ${g.slice(0, 48)}`);
  if (!ok) console.log(`      wanted: ${w}`);
}

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/* ------------------------------------------------ every route is documented */

let fresh = true;
try {
  execFileSync("npx", ["tsx", "scripts/generate-api-index.mts", "--check"], { stdio: "pipe" });
} catch {
  fresh = false;
}
check("the generated route index matches the files on disk", fresh, true);

const routeFiles = walk(join(ROOT, "app/api/v1")).filter((f) => f.endsWith("route.ts"));
const undeclared = routeFiles
  .filter((f) => !f.includes("openapi.json"))
  .filter((f) => !readFileSync(f, "utf8").includes("publicApi("))
  .map((f) => relative(ROOT, f));
check("every /api/v1 route is declared with publicApi (so it is documented)", undeclared, []);

const doc = buildOpenApiDocument("https://ogawifi.online") as {
  paths: Record<string, Record<string, { summary?: string; "x-required-scope"?: string; parameters: { name: string; in: string }[] }>>;
  webhooks: Record<string, unknown>;
  components: { schemas: Record<string, unknown> };
};
check("every route in the index is in the document", API_ROUTES.map((r) => r.path).filter((p) => !doc.paths[p]), []);

const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([m, op]) => ({ path, m, op })));
check("there is at least one operation", ops.length > 0, true);
check("every operation has a summary", ops.filter((o) => !o.op.summary?.trim()).map((o) => `${o.m} ${o.path}`), []);
check("every operation names a real scope",
  ops.filter((o) => !(API_SCOPES as readonly string[]).includes(o.op["x-required-scope"] ?? "")).map((o) => `${o.m} ${o.path}`), []);
check("every {param} in a path is documented as a path parameter",
  ops.flatMap((o) =>
    [...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).filter((name) => !o.op.parameters.some((p) => p.in === "path" && p.name === name)).map((n) => `${o.path}:${n}`)
  ), []);

/* ------------------------------------------------ references resolve */

const refs = [...new Set(JSON.stringify(doc).match(/#\/components\/schemas\/[A-Za-z0-9_]+/g) ?? [])];
check("every schema reference resolves", refs.filter((r) => !(r.split("/").pop()! in doc.components.schemas)), []);
check("no Zod-internal $defs reference leaked into the document", JSON.stringify(doc).includes("#/$defs/"), false);

/* ------------------------------------------------ webhooks */

check("every event type is in the document", WEBHOOK_EVENT_TYPES.filter((t) => !doc.webhooks[t]), []);
check("the decision hook is in the document", Boolean(doc.webhooks[HOOK_EVENT]), true);

/* ------------------------------------------------ every error code is described */

// Literal codes thrown anywhere in the API's code paths.
const sources = [join(ROOT, "lib/public-api.ts"), ...routeFiles];
const thrown = new Map<string, number>();
for (const file of sources) {
  for (const m of readFileSync(file, "utf8").matchAll(/new ApiError\(\s*(\d{3}),\s*"([a-z_]+)"/g)) {
    thrown.set(m[2], Number(m[1]));
  }
}
check("found the codes the code throws", thrown.size > 5, true);
check("every thrown code is in the error catalog, with the same status",
  [...thrown].filter(([code, status]) => ERROR_CATALOG[code]?.status !== status).map(([c, s]) => `${s} ${c}`), []);

// `invalid_<param>` is built from each query parameter's name.
const params = [...new Set(ops.flatMap((o) => o.op.parameters.filter((p) => p.in === "query").map((p) => p.name)))];
check("every query parameter's invalid_<name> code is in the catalog",
  params.filter((p) => ERROR_CATALOG[`invalid_${p}`]?.status !== 400), []);

/* ------------------------------------------------ the published samples work */

// The code a tenant copies from /developers is run here against our own
// signing, so a sample that stopped working fails the build.
{
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { docSections } = await import("../lib/api-docs-content");
  const { signatureHeader, verifyLinkCallback } = await import("../lib/hook-signing");
  const sample = (id: string) => docSections().find((x) => x.id === id)!.body.split("```js\n")[1].split("```")[0];

  const verify = new Function("require", `${sample("signatures")}\nreturn verifyOgaWiFi;`)(require);
  const body = '{"id":"evt_1","type":"voucher.issued"}';
  const t = Math.floor(Date.now() / 1000);
  check("the published verifier accepts our signature", verify(body, signatureHeader(["whsec_a"], t, body), "whsec_a"), true);
  check("the published verifier rejects the wrong secret", verify(body, signatureHeader(["whsec_b"], t, body), "whsec_a"), false);
  check("the published verifier rejects a stale signature", verify(body, signatureHeader(["whsec_a"], t - 3600, body), "whsec_a"), false);
  check("the published verifier rejects a changed body", verify(body + " ", signatureHeader(["whsec_a"], t, body), "whsec_a"), false);

  const callbackUrl = new Function("require", "crypto", `${sample("decision-hooks")}\nreturn callbackUrl;`)(require, require("node:crypto"));
  const state = "ab".repeat(24);
  const url = new URL(callbackUrl({ state, callback: "https://ogawifi.online/api/hooks/link/callback" }, { id: "MEMBER-1" }, "whsec_h"));
  check("the published linking sample produces a callback our server accepts",
    verifyLinkCallback(["whsec_h"], {
      t: url.searchParams.get("t"), state: url.searchParams.get("state") ?? "",
      externalId: url.searchParams.get("external_id") ?? "", sig: url.searchParams.get("sig"),
    }, Math.floor(Date.now() / 1000)), true);
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed > 0 ? 1 : 0);
