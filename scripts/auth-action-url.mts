/**
 * Reads or sets where Firebase email action links land.
 *
 * Every Firebase auth email - verification, email change, and **password
 * reset** - sends the recipient to one URL, stored as a single project-wide
 * `notification.sendEmail.callbackUri`. The console shows a "customize action
 * URL" control under each template, which makes it look per-template. It is
 * not: one value serves all of them, so there is no way to migrate one flow
 * at a time. That is exactly why `/auth/action` handles every mode rather
 * than just email verification (docs/auth-and-security.md).
 *
 * This exists because the Firebase console can refuse the change with a bare
 * "An error occurred updating action URL" while the underlying API accepts it
 * perfectly well - the project config, the authorized domain and the URL are
 * all fine, and the failure is in the console. Rather than leave that as
 * folklore, the change is scriptable and reversible.
 *
 * Read what is set now:
 *   npm run auth:action-url
 *
 * Point links at our own branded handler:
 *   npm run auth:action-url -- --set custom
 *
 * Put Firebase's stock handler back (the rollback, if anything misbehaves):
 *   npm run auth:action-url -- --set default
 *
 * ## Before setting this to `custom`
 *
 * `/auth/action` must already be deployed and returning 200. The setting
 * takes effect immediately and applies to links already sitting in people's
 * inboxes, so flipping it first breaks password reset for everyone with
 * nothing failing anywhere to say so.
 */
import { config } from "dotenv";

// Mirrors the Next.js lookup order for a production run: .env.local wins,
// .env.production fills what it does not define. dotenv never overwrites an
// already-set variable, so loading in this order is what gives that. This
// script only ever talks to the live Firebase project, so the production
// NEXT_PUBLIC_APP_URL is the right one even when run from a dev machine.
config({ path: ".env.local", quiet: true });
config({ path: ".env.production", quiet: true });

const { GoogleAuth } = await import("google-auth-library");

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || "";
if (!projectId) {
  console.error("FIREBASE_ADMIN_PROJECT_ID is not set in .env.local");
  process.exit(1);
}

const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
if (!appUrl) {
  console.error("NEXT_PUBLIC_APP_URL is not set in .env.production");
  process.exit(1);
}
const CUSTOM = `${appUrl}/auth/action`;
const DEFAULT = `https://${projectId}.firebaseapp.com/__/auth/action`;

const args = process.argv.slice(2);
const setIndex = args.indexOf("--set");
const target =
  setIndex === -1
    ? null
    : args[setIndex + 1] === "custom"
      ? CUSTOM
      : args[setIndex + 1] === "default"
        ? DEFAULT
        : null;

if (setIndex !== -1 && !target) {
  console.error("Usage: npm run auth:action-url -- --set custom|default");
  process.exit(1);
}

const auth = new GoogleAuth({
  credentials: {
    client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    private_key: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(
      /\\n/g,
      "\n"
    ),
  },
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const client = await auth.getClient();
const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;

function show(cfg: unknown, label: string) {
  const data = cfg as {
    authorizedDomains?: string[];
    notification?: { sendEmail?: { callbackUri?: string } };
  };
  const uri = data.notification?.sendEmail?.callbackUri ?? "(unset)";
  console.log(`${label}: ${uri}`);
  return uri;
}

const before = await client.request({ url: base });
const current = show(before.data, "current");

const domains =
  (before.data as { authorizedDomains?: string[] }).authorizedDomains ?? [];
console.log(`authorized domains: ${domains.join(", ")}`);

if (!target) {
  console.log(`\ncustom would be:  ${CUSTOM}`);
  console.log(`default would be: ${DEFAULT}`);
  process.exit(0);
}

if (target === current) {
  console.log("\nAlready set to that. Nothing to do.");
  process.exit(0);
}

// The host of the URL has to be an authorized domain or the links it mints
// will be refused when they are opened, which fails far away from here and
// looks like a broken email rather than a misconfiguration.
const host = new URL(target).hostname;
if (!domains.includes(host)) {
  console.error(
    `\n${host} is not in the authorized domains list. Add it in the Firebase console ` +
      `(Authentication, Settings, Authorized domains) before setting this.`
  );
  process.exit(1);
}

if (target === CUSTOM) {
  // A page that is not there yet is the one failure mode that takes an
  // existing, working flow down with it.
  const probe = await fetch(target, { redirect: "follow" });
  if (!probe.ok) {
    console.error(
      `\n${target} returned ${probe.status}. Deploy it before pointing ` +
        `Firebase at it - password reset links would land on that page too.`
    );
    process.exit(1);
  }
  console.log(`\n${target} is live (${probe.status}).`);
}

try {
  await client.request({
    url: `${base}?updateMask=notification.sendEmail.callbackUri`,
    method: "PATCH",
    data: { notification: { sendEmail: { callbackUri: target } } },
  });
} catch (error) {
  // A Gaxios failure stringifies into a couple of hundred lines of stream
  // internals, which buries the one word that matters.
  const err = error as { response?: { status?: number; data?: unknown } };
  const detail = err.response?.data as
    | { error?: { message?: string } }
    | undefined;
  const message = detail?.error?.message ?? String(error);

  console.error(`\nRefused (${err.response?.status ?? "?"}): ${message}`);

  if (message === "EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED") {
    console.error(
      [
        "",
        "Google is refusing the change, not this project. The authorized domain,",
        "the URL and the credential are all fine - a no-op write of the same value",
        "succeeds, and only an actual change is rejected. The Firebase console hits",
        "the same API and reports it as 'An error occurred updating action URL'.",
        "",
        "Nothing is broken: links keep landing on Firebase's own handler, which",
        "works. Only the branding of that page is blocked. See docs/open-items.md.",
      ].join("\n")
    );
  }
  process.exit(1);
}

// Read back with a fresh request rather than trusting the write's response.
const after = await client.request({ url: base });
const now = show(after.data, "\nnow");

if (now !== target) {
  console.error("Read-back does not match what was set. Check the console.");
  process.exit(1);
}

console.log(
  target === CUSTOM
    ? "\nDone. Verification, email change AND password reset links now land on our page."
    : "\nRolled back to Firebase's own handler."
);
