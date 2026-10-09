/**
 * The router-side half of the captive portal.
 *
 * MikroTik serves the hotspot login page from its own flash and substitutes
 * `$(...)` placeholders as it does. We install a small shim that does
 * nothing but forward those values to the real portal, which we host.
 */

/**
 * A directory of our own under the router's `hotspot/`, so MikroTik's stock
 * pages are left exactly where they are. Reverting is then a single
 * `html-directory` change rather than restoring overwritten files -- and a
 * tenant who had already customised their portal doesn't lose it.
 */
export const PORTAL_HTML_DIRECTORY = "hotspot-oga";

/**
 * Hosts a client must reach *before* logging in. Without these the portal
 * is unreachable and the customer sees a blank page with no explanation,
 * so this list is the difference between the feature working and failing
 * closed.
 */
export function walledGardenHosts(rootDomain: string): string[] {
  return [
    // The portal itself, on whichever tenant subdomain they arrive at.
    rootDomain,
    `*.${rootDomain}`,
    // Paystack: the inline script, its API, and the checkout page.
    "*.paystack.co",
    "*.paystack.com",
    // Fonts and Firebase, which our pages pull at render time.
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "*.googleapis.com",
    "*.firebaseapp.com",
    // Avatars and brand icons (lib/utils.ts: getAvatarUrl, getBrandIconUrl).
    // The only external image host this app has - everything else is served
    // from our own origin. Missing here, every avatar and brand icon on a
    // pre-login page silently fails to load while the page itself renders
    // fine, which reads as "images are broken" rather than as a firewall.
    "api.dicebear.com",
  ];
}

/**
 * The shim RouterOS serves as `login.html`.
 *
 * Deliberately has no styling, no script dependency and no network calls of
 * its own: it runs in the half-second before the client has any internet,
 * inside whatever cut-down browser the OS decided to open. A `<meta>`
 * refresh works with JavaScript disabled; the script is a faster path when
 * it's available; the link is there for when neither fires.
 *
 * `-esc` variants are used wherever MikroTik offers one, since these values
 * land in a query string -- an unescaped `link-orig` containing its own
 * `?foo=bar` would otherwise truncate everything after it.
 */
export function buildPortalShim(portalUrl: string): string {
  const query = [
    "mac=$(mac-esc)",
    "ip=$(ip)",
    "link-login-only=$(link-login-only)",
    "link-orig=$(link-orig-esc)",
    "error=$(error)",
  ].join("&");

  const target = `${portalUrl}?${query}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connecting…</title>
<meta http-equiv="refresh" content="0; url=${target}">
<script type="text/javascript">window.location.replace("${target}");</script>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:3rem 1rem;color:#1b1f22">
<p>Taking you to the sign-in page…</p>
<p><a href="${target}">Continue</a></p>
</body>
</html>
`;
}

/**
 * The most recent voucher bought on this device at this tenant, if any.
 *
 * Lets the portal tell a returning customer their plan expired instead of
 * showing the same blank form a first-time visitor sees. Returns null for
 * anything unexpected -- a missing index, an unreachable Firestore -- since
 * a failed lookup should cost a nicety, never the portal itself.
 */
export async function lastVoucherForDevice(
  tenantId: string,
  mac: string | null
): Promise<{
  planName: string;
  status: string;
  createdAt: Date | null;
} | null> {
  if (!mac) return null;

  try {
    const { adminDb } = await import("@/lib/firebase-admin");
    const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

    const snapshot = await adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .where("deviceMac", "==", mac)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const data = snapshot.docs[0].data();
    return {
      planName: data.planName ?? "",
      status: data.status ?? "",
      createdAt: data.createdAt?.toDate?.() ?? null,
    };
  } catch (error) {
    console.error("Device voucher lookup failed:", error);
    return null;
  }
}
