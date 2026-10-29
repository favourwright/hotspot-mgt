/**
 * The SSRF guard on tenant-supplied URLs (lib/safe-fetch.ts).
 *
 * The gate before any tenant can save a hook URL. Every hostile case here
 * is a way a hook URL could reach something on our side of the network:
 * the metadata service, the WireGuard manager on localhost, another tenant's
 * router over the tunnel. A pass means the request never left.
 *
 * Three layers, tested separately:
 *  1. URL syntax (`assertHookUrl`), including every notation for an IP;
 *  2. the address allowlist (`isPublicAddress`);
 *  3. the real fetcher with an injected resolver, proving the check runs at
 *     connect time on every resolved address; and, with a relaxed policy
 *     against a local server, the timeout, size cap and redirect handling.
 *
 * Run: npm run test:safe-fetch
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  STRICT_POLICY,
  SafeFetchError,
  assertHookUrl,
  createSafeFetch,
  isPublicAddress,
} from "../lib/safe-fetch";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(66)} ${String(got)}`);
  if (!ok) console.log(`      wanted: ${String(want)}`);
}

function urlRejected(raw: string): string {
  try {
    assertHookUrl(raw);
    return "accepted";
  } catch (error) {
    return error instanceof SafeFetchError ? `rejected:${error.kind}` : "threw";
  }
}

/* ------------------------------------------------ 1. URL syntax */

check("plain https hostname", urlRejected("https://hooks.example.com/check"), "accepted");
check("explicit :443", urlRejected("https://hooks.example.com:443/check"), "accepted");
check("http", urlRejected("http://hooks.example.com/check"), "rejected:url");
check("other port", urlRejected("https://hooks.example.com:8443/x"), "rejected:url");
check("credentials in URL", urlRejected("https://user:pw@hooks.example.com/x"), "rejected:url");
check("not a URL", urlRejected("hooks.example.com"), "rejected:url");
check("ftp", urlRejected("ftp://hooks.example.com/x"), "rejected:url");
check("localhost", urlRejected("https://localhost/x"), "rejected:url");
check("sub.localhost", urlRejected("https://evil.localhost/x"), "rejected:url");
check(".internal", urlRejected("https://metadata.google.internal/x"), "rejected:url");
check("single-label host", urlRejected("https://intranet/x"), "rejected:url");
check("dotted IPv4", urlRejected("https://127.0.0.1/x"), "rejected:url");
check("short IPv4 127.1", urlRejected("https://127.1/x"), "rejected:url");
check("octal IPv4", urlRejected("https://0177.0.0.1/x"), "rejected:url");
check("decimal IPv4", urlRejected("https://2130706433/x"), "rejected:url");
check("hex IPv4", urlRejected("https://0x7f000001/x"), "rejected:url");
check("metadata IP", urlRejected("https://169.254.169.254/latest"), "rejected:url");
check("public IP literal is still refused", urlRejected("https://8.8.8.8/x"), "rejected:url");
check("IPv6 loopback", urlRejected("https://[::1]/x"), "rejected:url");
check("IPv4-mapped IPv6", urlRejected("https://[::ffff:127.0.0.1]/x"), "rejected:url");
check("overlong URL", urlRejected(`https://a.example.com/${"x".repeat(2100)}`), "rejected:url");

/* ------------------------------------------------ 2. address allowlist */

for (const [ip, want] of [
  ["8.8.8.8", true],
  ["1.1.1.1", true],
  ["2606:4700:4700::1111", true],
  ["127.0.0.1", false],
  ["127.255.255.254", false],
  ["0.0.0.0", false],
  ["10.0.0.1", false],
  ["10.10.0.5", false], // the WireGuard tunnel subnet
  ["172.16.0.1", false],
  ["172.31.255.255", false],
  ["192.168.1.1", false],
  ["169.254.169.254", false],
  ["100.64.0.1", false],
  ["224.0.0.1", false],
  ["255.255.255.255", false],
  ["240.0.0.1", false],
  ["::1", false],
  ["::", false],
  ["fe80::1", false],
  ["fc00::1", false],
  ["fd12:3456::1", false],
  ["ff02::1", false],
  ["::ffff:127.0.0.1", false],
  ["::ffff:10.0.0.1", false],
  ["::ffff:8.8.8.8", true],
  ["64:ff9b::7f00:1", false], // NAT64 wrapping 127.0.0.1
  ["2002:7f00:1::", false], // 6to4 wrapping 127.0.0.1
  ["not-an-ip", false],
] as const) {
  check(`isPublicAddress(${ip})`, isPublicAddress(ip), want);
}

/* ------------------------------------------------ 3a. strict fetcher, injected DNS */

// A resolver that answers whatever the test says, so these never touch the
// network: the request must be refused before any connection is made.
function strictWithDns(answer: Array<{ address: string; family: number }>) {
  return createSafeFetch({
    ...STRICT_POLICY,
    lookup: (_host, _opts, cb) => cb(null, answer),
  });
}

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "fetched";
  } catch (error) {
    return error instanceof SafeFetchError ? `blocked:${error.kind}` : `threw:${String(error)}`;
  }
}

const OPTS = { method: "POST" as const, headers: {}, body: "{}", timeoutMs: 2000, maxBytes: 1024 };

check("hostname resolving to 127.0.0.1 is blocked at connect",
  await outcome(strictWithDns([{ address: "127.0.0.1", family: 4 }])("https://looks-fine.example.com/", OPTS)),
  "blocked:address");
check("hostname resolving to the metadata address is blocked",
  await outcome(strictWithDns([{ address: "169.254.169.254", family: 4 }])("https://looks-fine.example.com/", OPTS)),
  "blocked:address");
check("public first, private second: blocked (every address is checked)",
  await outcome(strictWithDns([
    { address: "8.8.8.8", family: 4 },
    { address: "10.10.0.5", family: 4 },
  ])("https://looks-fine.example.com/", OPTS)),
  "blocked:address");
check("IPv4-mapped loopback from DNS is blocked",
  await outcome(strictWithDns([{ address: "::ffff:127.0.0.1", family: 6 }])("https://looks-fine.example.com/", OPTS)),
  "blocked:address");
check("no addresses at all is blocked",
  await outcome(strictWithDns([])("https://looks-fine.example.com/", OPTS)),
  "blocked:address");
check("bad URL never reaches DNS",
  await outcome(strictWithDns([{ address: "8.8.8.8", family: 4 }])("http://looks-fine.example.com/", OPTS)),
  "blocked:url");

/* ------------------------------------------------ 3b. relaxed policy, local server */

// Same fetcher, with the URL and address rules relaxed so it can reach a
// local test server. Everything below is about what happens after a
// connection is allowed.
const relaxed = createSafeFetch({
  checkUrl: (raw) => new URL(raw),
  allowAddress: () => true,
  lookup: STRICT_POLICY.lookup,
});

const server = http.createServer((req, res) => {
  const path = req.url ?? "/";
  if (path === "/ok") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ allowed: true }));
  } else if (path === "/redirect") {
    res.writeHead(302, { location: "http://127.0.0.1:1/internal" });
    res.end();
  } else if (path === "/500") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ allowed: true }));
  } else if (path === "/big") {
    res.writeHead(200);
    res.end("x".repeat(5000));
  } else if (path === "/slow-headers") {
    setTimeout(() => { res.writeHead(200); res.end("{}"); }, 1500);
  } else if (path === "/drip") {
    res.writeHead(200);
    const timer = setInterval(() => res.write("x"), 100);
    req.on("close", () => clearInterval(timer));
  } else if (path === "/utf8") {
    res.writeHead(200);
    // A multibyte character split across two writes.
    const bytes = Buffer.from("café ✓", "utf8");
    res.write(bytes.subarray(0, 4));
    setTimeout(() => res.end(bytes.subarray(4)), 20);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const ok = await relaxed(`${base}/ok`, OPTS);
check("2xx is ok", ok.ok, true);
check("body read", ok.body, JSON.stringify({ allowed: true }));

const redirected = await relaxed(`${base}/redirect`, OPTS);
check("redirect is not followed", redirected.status, 302);
check("redirect is not ok", redirected.ok, false);

const fiveHundred = await relaxed(`${base}/500`, OPTS);
check("500 carrying allowed:true is not ok", fiveHundred.ok, false);

check("body over the byte cap is refused",
  await outcome(relaxed(`${base}/big`, { ...OPTS, maxBytes: 1000 })), "blocked:too_large");
check("slow headers hit the deadline",
  await outcome(relaxed(`${base}/slow-headers`, { ...OPTS, timeoutMs: 300 })), "blocked:timeout");

const started = Date.now();
const drip = await outcome(relaxed(`${base}/drip`, { ...OPTS, timeoutMs: 500, maxBytes: 100_000 }));
check("a trickling body cannot outlast the deadline", drip, "blocked:timeout");
check("and is cut off near the deadline, not later", Date.now() - started < 1500, true);

check("multibyte character split across chunks decodes intact",
  (await relaxed(`${base}/utf8`, OPTS)).body, "café ✓");

server.close();

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed > 0 ? 1 : 0);
