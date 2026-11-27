/**
 * The custom branding rules, exercised without Firestore or a router.
 *
 * Three things here guard a page every Wi-Fi customer sees:
 *
 *  - the logo check is the server's boundary, so it has to refuse what a
 *    hand-made request could send: SVG, a type that lies about itself,
 *    something too big in bytes or in pixels;
 *  - the accent colour is spliced into CSS on two kinds of page, so nothing
 *    but six hex digits may ever come out of normalization;
 *  - the router pages are generated text, and a replacement that silently
 *    did not apply has shipped before. Both pages are checked for the logo
 *    slot and the loader, and their script is parsed to prove it is valid.
 *
 * Run: npm run test:branding
 */
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

import {
  LOGO_MAX_BYTES,
  buildBrandFile,
  checkLogoDataUri,
  contrastRatio,
  imageDimensions,
  normalizeAccentColor,
  readableForeground,
  sniffImageType,
} from "../lib/branding";
import {
  PORTAL_PAGES_VERSION,
  buildAloginPage,
  buildStatusPage,
} from "../lib/hotspot-portal";
import { brandSyncKey } from "../lib/portal-brand-sync";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

/* ------------------------------------------------------------ fixtures */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A real, decodable RGBA PNG. `noise` makes it incompressible, for size tests. */
function png(width: number, height: number, noise = false): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    if (noise) randomBytes(width * 4).copy(row, 1);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A JPEG header: SOI, an APP0 segment, then SOF0 with the size. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** A WebP RIFF header of each of the three encodings. */
function webp(kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Buffer {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(32, 4);
  b.write("WEBP", 8, "ascii");
  b.write(kind, 12, "ascii");
  if (kind === "VP8 ") {
    b.writeUInt16LE(width, 26);
    b.writeUInt16LE(height, 28);
  } else if (kind === "VP8L") {
    b[20] = 0x2f;
    const w = width - 1, h = height - 1;
    b[21] = w & 0xff;
    b[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
    b[23] = (h >> 2) & 0xff;
    b[24] = (h >> 10) & 0x0f;
  } else {
    const w = width - 1, h = height - 1;
    b[24] = w & 0xff; b[25] = (w >> 8) & 0xff; b[26] = (w >> 16) & 0xff;
    b[27] = h & 0xff; b[28] = (h >> 8) & 0xff; b[29] = (h >> 16) & 0xff;
  }
  return b;
}

const uri = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;
const u8 = (b: Buffer) => new Uint8Array(b);

/* ---------------------------------------------------------- dimensions */

console.log("image headers");
const dims = (b: Buffer, mime: Parameters<typeof imageDimensions>[1]) =>
  JSON.stringify(imageDimensions(u8(b), mime));
check("png 200x96", dims(png(200, 96), "image/png") === '{"width":200,"height":96}');
check("jpeg 300x90", dims(jpeg(300, 90), "image/jpeg") === '{"height":90,"width":300}');
check("webp lossy 120x80", dims(webp("VP8 ", 120, 80), "image/webp") === '{"width":120,"height":80}');
check("webp lossless 250x96", dims(webp("VP8L", 250, 96), "image/webp") === '{"width":250,"height":96}', dims(webp("VP8L", 250, 96), "image/webp"));
check("webp extended 320x96", dims(webp("VP8X", 320, 96), "image/webp") === '{"width":320,"height":96}');
check("sniff png", sniffImageType(u8(png(2, 2))) === "image/png");
check("sniff jpeg", sniffImageType(u8(jpeg(2, 2))) === "image/jpeg");
check("sniff webp", sniffImageType(u8(webp("VP8 ", 2, 2))) === "image/webp");
check("sniff svg is nothing", sniffImageType(u8(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))) === null);

/* ---------------------------------------------------------- logo check */

console.log("logo check");
check("a square png passes", checkLogoDataUri(uri("image/png", png(96, 96))).ok);
check("a letterboxed png passes", checkLogoDataUri(uri("image/png", png(96, 30))).ok);
check("a small jpeg passes", checkLogoDataUri(uri("image/jpeg", jpeg(96, 96))).ok);
check("a small webp passes", checkLogoDataUri(uri("image/webp", webp("VP8L", 96, 96))).ok);
check("svg is refused", !checkLogoDataUri(uri("image/svg+xml", Buffer.from("<svg/>"))).ok);
check("png bytes labelled jpeg are refused", !checkLogoDataUri(uri("image/jpeg", png(10, 10))).ok);
check("text labelled png is refused", !checkLogoDataUri(uri("image/png", Buffer.from("<script>alert(1)</script>"))).ok);
check("too wide is refused", !checkLogoDataUri(uri("image/png", png(320, 96))).ok);
check("too tall is refused", !checkLogoDataUri(uri("image/png", png(100, 400))).ok);
const noisy = png(120, 60, true);
check(`fixture really is over the cap (${noisy.length} > ${LOGO_MAX_BYTES})`, noisy.length > LOGO_MAX_BYTES);
check("over the byte cap is refused", !checkLogoDataUri(uri("image/png", noisy)).ok);
check("not a data URI is refused", !checkLogoDataUri("https://example.com/logo.png").ok);
check("a non-string is refused", !checkLogoDataUri(42).ok);
check("trailing junk after base64 is refused", !checkLogoDataUri(uri("image/png", png(10, 10)) + "\"><b>").ok);

/* -------------------------------------------------------------- colour */

console.log("accent colour");
check("#ABC expands", normalizeAccentColor("#ABC") === "#aabbcc");
check("#1D4ED8 lowercases", normalizeAccentColor(" #1D4ED8 ") === "#1d4ed8");
for (const bad of ["red", "1d4ed8", "#1d4ed8;}body{display:none", "#12345", "#1234567", "rgb(0,0,0)", "", null, 7]) {
  check(`refuses ${JSON.stringify(bad)}`, normalizeAccentColor(bad) === null);
}
check("dark accent gets white text", readableForeground("#1d4ed8") === "#ffffff");
check("light accent gets dark text", readableForeground("#facc15") === "#090b0c");
for (const accent of ["#000000", "#ffffff", "#c6005c", "#22c55e", "#808080", "#facc15", "#0ea5e9"]) {
  const ratio = contrastRatio(accent, readableForeground(accent));
  check(`${accent} text contrast ${ratio.toFixed(2)} >= 4.5`, ratio >= 4.5);
}

/* ---------------------------------------------------------- brand file */

console.log("brand.json");
const goodLogo = uri("image/png", png(96, 96));
check("off is an empty object", buildBrandFile(null) === "{}");
const full = JSON.parse(buildBrandFile({ logo: goodLogo, accentColor: "#1D4ED8" }));
check("carries the logo", full.l === goodLogo);
check("carries a normalized accent", full.a === "#1d4ed8");
check("carries the text colour", full.f === "#ffffff");
const hostile = JSON.parse(
  buildBrandFile({ logo: uri("image/svg+xml", Buffer.from("<svg/>")), accentColor: "red;}" })
);
check("drops an invalid logo and colour", Object.keys(hostile).length === 0, hostile);
check("a logo under the cap stays under 9KB of JSON", buildBrandFile({ logo: goodLogo, accentColor: "#000000" }).length < 9 * 1024);

/* ------------------------------------------------------------ sync key */

console.log("sync key");
const on = { logo: goodLogo, accentColor: null };
check("branding off ignores the saved version", brandSyncKey(null, 5) === brandSyncKey(null, 9));
check("a new save moves the key", brandSyncKey(on, 5) !== brandSyncKey(on, 9));
check("losing the plan feature moves the key", brandSyncKey(on, 5) !== brandSyncKey(null, 5));
check("the key carries the page version", brandSyncKey(null, 0).startsWith(`p${PORTAL_PAGES_VERSION}:`));

/* -------------------------------------------------------- router pages */

console.log("router pages");
for (const [name, page] of [
  ["alogin.html", buildAloginPage({ brandName: "Mama's <Cafe>" })],
  ["status.html", buildStatusPage({ brandName: "Mama's <Cafe>" })],
] as const) {
  check(`${name} has the logo slot`, page.includes('<img id="logo" class="logo hide" alt="">'));
  check(`${name} calls loadBrand`, /\nloadBrand\(\);\nloadPlan\(\);/.test(page));
  check(`${name} escapes the name`, page.includes("Mama's &lt;Cafe&gt;"));
  const script = page.slice(page.indexOf("<script"), page.indexOf("</script>"));
  const body = script.slice(script.indexOf(">") + 1);
  check(`${name} script has no RouterOS placeholder`, !body.includes("$("));
  try {
    new Function(body);
    check(`${name} script parses`, true);
  } catch (error) {
    check(`${name} script parses`, false, String(error));
  }
}

console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
