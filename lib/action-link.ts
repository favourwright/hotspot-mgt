/**
 * Moves a Firebase email action link onto our own handler page.
 *
 * Every link the Admin SDK mints (`generatePasswordResetLink`,
 * `generateEmailVerificationLink`, `generateVerifyAndChangeEmailLink`) points
 * at the project's action URL, `notification.sendEmail.callbackUri`. That is
 * still Firebase's default `<project>.firebaseapp.com/__/auth/action`, because
 * Google refuses to change it (`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, see
 * docs/auth-and-security.md).
 *
 * The setting only decides which page the link opens. What the link proves is
 * the `oobCode`, and it is checked by Firebase's API wherever it is presented
 * from; `/auth/action` already reads `mode` and `oobCode` from its query and
 * spends the code with the client SDK. So for every email we send ourselves,
 * we take the code out of Firebase's link and put it on our page instead.
 * Checked against the live project on 2026-11-27: a rewritten reset code
 * verified as PASSWORD_RESET for the right account.
 *
 * `apiKey` is dropped on purpose: our page has its own Firebase config, and
 * the key is not ours to forward. Emails Firebase still sends itself (the
 * `recoverEmail` undo link to an old address) keep its handler.
 *
 * Pure, so `npm run test:action-link` can pin it without credentials.
 */

const CARRIED = ["mode", "oobCode", "continueUrl", "lang"] as const;

export function ownActionLink(firebaseLink: string, handlerUrl: string): string {
  const source = new URL(firebaseLink);
  if (!source.searchParams.get("mode") || !source.searchParams.get("oobCode")) {
    // Not the shape we know. Better a working link to Firebase's page than a
    // broken one to ours.
    return firebaseLink;
  }

  const target = new URL(handlerUrl);
  for (const name of CARRIED) {
    const value = source.searchParams.get(name);
    if (value) target.searchParams.set(name, value);
  }
  return target.toString();
}
