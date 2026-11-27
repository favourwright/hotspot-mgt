/**
 * A tenant's logo and accent colour: the rules both ends agree on.
 *
 * Pure, with no Firebase and no Node-only APIs, because the settings page
 * imports it in the browser to compress a logo to fit, and the API route
 * imports it on the server to refuse anything that does not. The browser's
 * half is a courtesy; this file's checks on the server are the boundary,
 * because anyone can skip the page and send the route whatever they like.
 *
 * ## Why the logo is so small
 *
 * It is stored on the tenant document (one read the portal already pays
 * for), written into the portal page itself, and carried to the router as
 * text inside `brand.json`, because the router's REST API writes files as
 * text and has no binary upload. Each of those wants it tiny, and the
 * portal loads over a connection the customer has not paid for yet.
 *
 * The logo is a square mark: fitted inside a square, previewed in a square
 * on the settings page, and shown in a 64px square on both kinds of portal
 * page, so what the owner sees is what customers see. 96px of image covers
 * high-density screens at that size with nothing to spare. A wide wordmark
 * still works, letterboxed inside the square, but reads small.
 *
 * ## Why no SVG
 *
 * An SVG is a document that can carry script, served here to the public on
 * our origin. Raster formats only, checked against the file's own first
 * bytes rather than whatever the data URI claims to be.
 */

/** The cap on the decoded image, in bytes. About 8KB once base64-encoded. */
export const LOGO_MAX_BYTES = 6 * 1024;

/** The square the settings page fits a logo inside before compressing. */
export const LOGO_TARGET_SIZE = 96;

/**
 * What the server accepts. Looser than the target, so a logo the browser
 * produced a pixel or two off is not refused, and tight enough that nobody
 * stores a photo by sending the route a hand-made request.
 */
export const LOGO_MAX_HEIGHT = 160;
export const LOGO_MAX_WIDTH = 160;

export const LOGO_MIME_TYPES = ["image/png", "image/webp", "image/jpeg"] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/** The file the router-rendered pages read the branding from. */
export const BRAND_FILE = "brand.json";

/** What the portal is actually shown, once the plan has been checked. */
export interface EffectiveBranding {
  logo: string | null;
  accentColor: string | null;
}

/* ---------------------------------------------------------------- colour */

/**
 * `#abc` or `#aabbcc`, any case, to `#aabbcc`; anything else to null.
 *
 * The result is spliced into CSS on two kinds of page, so this is the
 * entire defence against a colour that is really a stylesheet: nothing that
 * is not exactly six hex digits after a hash ever comes out.
 */
export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  return null;
}

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a normalized `#rrggbb`. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG contrast ratio between two normalized colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const LIGHT_TEXT = "#ffffff";
export const DARK_TEXT = "#090b0c";

/**
 * The text colour for a button filled with `accent`: whichever of white and
 * near-black reads better on it. An owner picks one colour; making them
 * pick a second, and get it wrong, is how a button becomes unreadable.
 */
export function readableForeground(accent: string): string {
  return contrastRatio(accent, LIGHT_TEXT) >= contrastRatio(accent, DARK_TEXT)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

/* ------------------------------------------------------------------ logo */

export interface ParsedLogo {
  mime: LogoMimeType;
  bytes: number;
  width: number;
  height: number;
}

export type LogoCheck =
  | { ok: true; logo: ParsedLogo }
  | { ok: false; error: string };

const DATA_URI = /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** What the file's own first bytes say it is, whatever it was called. */
export function sniffImageType(b: Uint8Array): LogoMimeType | null {
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Width and height from the image header, without decoding the image.
 *
 * A few lines per format rather than an image library: the only one worth
 * having (`sharp`) is a native module, and adding a dependency means an
 * `npm install` on the VPS, which the runbook treats as a rare and careful
 * event. Null when the header is not one these formats can have.
 */
export function imageDimensions(
  b: Uint8Array,
  mime: LogoMimeType
): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

  if (mime === "image/png") {
    // IHDR is always the first chunk, at a fixed offset.
    if (b.length < 24) return null;
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
    return { width: u32be(16), height: u32be(20) };
  }

  if (mime === "image/jpeg") {
    // Walk the segments to the first start-of-frame marker.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      // Fill bytes between segments.
      if (marker === 0xff) {
        i++;
        continue;
      }
      const isSof =
        marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + u16be(i + 2);
    }
    return null;
  }

  // WebP: the first chunk after the RIFF header says which encoding.
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8 ") {
    return {
      width: (b[26] | (b[27] << 8)) & 0x3fff,
      height: (b[28] | (b[29] << 8)) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8X") {
    return {
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  }
  return null;
}

/**
 * Everything the server checks about a logo before storing it.
 *
 * The error strings are shown to the owner as they are, so they say what
 * to do rather than what went wrong inside.
 */
export function checkLogoDataUri(value: unknown): LogoCheck {
  if (typeof value !== "string") {
    return { ok: false, error: "That logo could not be read. Try another image." };
  }
  // Cheap ceiling before any decoding: base64 is 4/3 the size of its bytes.
  if (value.length > Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 64) {
    return { ok: false, error: "That logo is too large. Try a simpler image." };
  }

  const match = DATA_URI.exec(value);
  if (!match) {
    return { ok: false, error: "Use a PNG, WebP or JPEG image." };
  }

  const bytes = decodeBase64(match[2]);
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: "That logo could not be read. Try another image." };
  }
  if (bytes.length > LOGO_MAX_BYTES) {
    return { ok: false, error: "That logo is too large. Try a simpler image." };
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== match[1]) {
    return { ok: false, error: "Use a PNG, WebP or JPEG image." };
  }

  const size = imageDimensions(bytes, sniffed);
  if (!size || size.width < 1 || size.height < 1) {
    return { ok: false, error: "That logo could not be read. Try another image." };
  }
  if (size.width > LOGO_MAX_WIDTH || size.height > LOGO_MAX_HEIGHT) {
    return { ok: false, error: "That logo is too large. Try a simpler image." };
  }

  return { ok: true, logo: { mime: sniffed, bytes: bytes.length, ...size } };
}

/* ------------------------------------------------------- router brand file */

/**
 * The contents of `brand.json` on the router.
 *
 * Short keys, the same as `plan.json`: parsed by a page, never read by a
 * person. `l` the logo, `a` the accent, `f` the text colour on the accent.
 * Branding that is off is written as `{}` rather than the file being
 * removed, so a plan without the feature actually takes the old logo off the router instead of
 * leaving the last copy behind.
 *
 * Every value is re-checked here even though the route checked it on the
 * way in: this goes onto a page every customer sees, and a document
 * written by something other than that route is not ours to trust.
 */
export function buildBrandFile(branding: EffectiveBranding | null): string {
  const out: { l?: string; a?: string; f?: string } = {};
  if (branding?.logo && checkLogoDataUri(branding.logo).ok) out.l = branding.logo;
  const accent = normalizeAccentColor(branding?.accentColor);
  if (accent) {
    out.a = accent;
    out.f = readableForeground(accent);
  }
  return JSON.stringify(out);
}
