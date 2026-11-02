/**
 * Which dependencies actually have to be installed on the VPS.
 *
 * ## Why this is not "every new dependency"
 *
 * The deploy ships `.next/` and nothing else. The App Router bundles
 * dependencies into that build output, client and server alike, so most
 * packages need no `node_modules` entry on the box at all. That has been
 * verified the hard way: `gsap`, `lenis` and all three `@dicebear`
 * packages run in production while being absent from the VPS entirely.
 *
 * Three kinds of package are NOT bundled and must exist there:
 *
 * 1. Anything on Next's own default-external list, which is where the
 *    packages that cannot survive bundling live (`firebase-admin`,
 *    `sharp`, `bcrypt`, `canvas` and about 75 others).
 * 2. Anything named in `serverExternalPackages` in `next.config.ts`.
 *    This is one line away at any time, and adding a package to it
 *    silently changes the deploy requirements for the next release.
 * 3. Native modules, which ship compiled binaries that no bundler can
 *    inline. Most are already on the list in (1); the scan below catches
 *    one that is not.
 *
 * And everything those three pull in transitively, because an external
 * package resolves its own dependencies from `node_modules` as well.
 *
 * ## Why it is worth a script rather than a rule of thumb
 *
 * The failure is silent in every place you would look for it. A missing
 * externalised package does not fail `npm run build`, does not fail the
 * `systemctl restart`, and does not fail the smoke tests in the runbook.
 * It throws `MODULE_NOT_FOUND` at runtime, on whichever single route
 * touches it, the first time somebody loads that page.
 *
 * Usage:
 *   npm run deps:check            # compare against the VPS
 *   npm run deps:check -- --local # just classify, no SSH
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SSH_KEY = process.env.SSH_KEY ?? `${process.env.HOME}/.ssh/ssh-key-2026-06-06.key`;
const VPS_HOST = process.env.VPS_HOST ?? "ubuntu@193.123.183.184";
const REMOTE_DIR = "/home/ubuntu/hotspot-mgt";

const localOnly = process.argv.includes("--local");

/** Next ships its list as JSONC: `//` comments and trailing commas. */
function readJsonc(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const stripped = raw
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[\]}])/g, "$1");
  return JSON.parse(stripped);
}

function nextExternalList(): string[] {
  // Two copies ship; either will do, and the path has moved between
  // versions, so a missing file is reported rather than assumed empty.
  const candidates = [
    "node_modules/next/dist/lib/server-external-packages.jsonc",
    "node_modules/next/dist/lib/server-external-packages.json",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error(
      "Could not find Next's default-external package list. It has moved;\n" +
        "find the new path under node_modules/next/dist and update this script.\n" +
        "Refusing to report 'nothing to install' from a list we could not read."
    );
    process.exit(2);
  }
  return readJsonc(found);
}

/** `serverExternalPackages`, read from the config rather than guessed. */
async function configuredExternals(): Promise<string[]> {
  try {
    // The specifier is a variable so TypeScript does not resolve it
    // statically: a literal "../next.config.ts" trips TS5097, because
    // importing an explicit .ts extension needs a compiler flag this
    // project does not set. tsx resolves it fine at run time.
    const configPath = "../next.config.ts";
    const mod = await import(configPath);
    const config = (mod.default ?? {}) as { serverExternalPackages?: string[] };
    return config.serverExternalPackages ?? [];
  } catch (error) {
    console.error(
      `Could not read next.config.ts, so serverExternalPackages is unknown: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(2);
  }
}

/**
 * Everything an externalised package will `require` at run time.
 *
 * An external package is loaded from `node_modules` rather than from the
 * bundle, so its own dependencies are loaded from there too - they are
 * every bit as required on the VPS as the root that pulls them, and none
 * of them appear on Next's list.
 *
 * This is not hypothetical. `@google-cloud/firestore` is an *optional*
 * peer of `firebase-admin`, so it can silently fail to install, and when
 * it does every Admin-SDK route fails with an opaque empty 500. It is
 * pinned as a direct dependency for that reason, and a check that only
 * looked at Next's list would have called it "bundled" and cleared a
 * deploy that was about to break. See `docs/decisions-and-gotchas.md`.
 *
 * Optional dependencies are walked deliberately: "optional" describes
 * whether the install may skip it, not whether the code needs it. That
 * is also why the result is then narrowed, in `main`, to packages this
 * project lists in its own `package.json`. Walking the full closure and
 * demanding all of it was the first attempt and it was wrong: it asked
 * for `@google-cloud/storage`, an optional dependency of `firebase-admin`
 * that nothing here loads, and a check that reports things that are not
 * problems is a check people learn to skip.
 *
 * A direct dependency is different. Somebody wrote it into
 * `package.json` on purpose, which for a package reachable only through
 * an external root is precisely the `@google-cloud/firestore` situation.
 */
function runtimeClosure(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);

    const manifest = join("node_modules", name, "package.json");
    if (!existsSync(manifest)) continue;

    try {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      for (const dep of [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ]) {
        if (!seen.has(dep)) queue.push(dep);
      }
    } catch {
      // An unreadable manifest is not a reason to stop checking the rest.
    }
  }

  return seen;
}

/** A package carrying compiled binaries cannot be bundled by anything. */
function looksNative(dep: string): boolean {
  const dir = join("node_modules", dep);
  if (!existsSync(dir)) return false;
  if (existsSync(join(dir, "binding.gyp"))) return true;
  if (existsSync(join(dir, "prebuilds"))) return true;
  try {
    return readdirSync(join(dir, "build", "Release")).some((f) =>
      f.endsWith(".node")
    );
  } catch {
    return false;
  }
}

function installedOnVps(packages: string[]): Set<string> {
  if (packages.length === 0) return new Set();
  const probe = packages
    .map((p) => `[ -d node_modules/${p} ] && echo "${p}"`)
    .join("; ");
  const out = execFileSync(
    "ssh",
    ["-i", SSH_KEY, "-o", "ConnectTimeout=15", VPS_HOST, `cd ${REMOTE_DIR} && { ${probe}; } || true`],
    { encoding: "utf8" }
  );
  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}

async function main() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const deps: string[] = Object.keys(pkg.dependencies ?? {});

  const nextExternals = nextExternalList();
  const configured = await configuredExternals();

  const roots = deps.filter(
    (d) => nextExternals.includes(d) || configured.includes(d) || looksNative(d)
  );
  // Roots, plus the direct dependencies that are only reachable through
  // one. Not the whole closure - see `runtimeClosure`.
  const closure = runtimeClosure(roots);
  const required = [
    ...new Set([...roots, ...deps.filter((d) => closure.has(d))]),
  ].sort();
  const bundled = deps.filter((d) => !required.includes(d));

  console.log(
    `${deps.length} direct dependencies: ${bundled.length} bundled into ` +
      `.next/, ${roots.length} externalised.`
  );
  const pulled = required.filter((d) => !roots.includes(d));
  if (pulled.length > 0) {
    console.log(
      `Plus ${pulled.length} direct ${
        pulled.length === 1 ? "dependency" : "dependencies"
      } reachable only through them: ${pulled.join(", ")}\n`
    );
  } else {
    console.log("");
  }
  console.log(`Externalised roots:`);
  for (const dep of roots) {
    const why = configured.includes(dep)
      ? "serverExternalPackages"
      : nextExternals.includes(dep)
        ? "Next default-external"
        : "native binary";
    console.log(`  ${dep}  (${why})`);
  }

  if (localOnly) {
    console.log(`\nSkipped the VPS check (--local).`);
    return;
  }

  const present = installedOnVps(required);
  const missing = required.filter((d) => !present.has(d));

  if (missing.length === 0) {
    console.log(
      `\nAll ${required.length} are present on the VPS. Nothing to install.`
    );
    return;
  }

  console.error(`\nMISSING on the VPS:`);
  for (const dep of missing) console.error(`  ${dep}`);
  console.error(
    `\nThese will not fail the build, the restart, or the runbook's smoke\n` +
      `tests. They throw MODULE_NOT_FOUND at runtime on whichever route\n` +
      `touches them. Install them there before the deploy is considered done:\n` +
      `\n  ssh -i ${SSH_KEY} ${VPS_HOST} \\\n` +
      `    "cd ${REMOTE_DIR} && npm install --omit=dev ${missing.join(" ")}"\n` +
      `\nCheck it first with --dry-run: on a partial node_modules npm reconciles the\n` +
      `whole tree. If that adds more than expected, use the empty-folder method in\n` +
      `docs/deploy-runbook.md instead.\n` +
      `\nNote this is a targeted install, NOT a bare \`npm install\`, which is\n` +
      `prohibited on the VPS - see the OOM incident in docs/deployment.md.`
  );
  process.exit(1);
}

main();
