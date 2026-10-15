import { readFileSync } from "node:fs";
import dotenv from "dotenv";

/**
 * Loads env the way a maintenance script needs it.
 *
 * Next.js resolves `.env.production` vs `.env.development.local` on its own
 * from `NODE_ENV`, but a script run under `tsx` gets none of that - it sees
 * only what `dotenv` is pointed at. So every script here would otherwise
 * carry its own copy of this decision, and each one would be a separate
 * chance to read the wrong file.
 *
 * These scripts talk to the live Firebase project and the live VPS, so
 * `.env.production` wins. `.env.development.local` fills in any name that
 * `.env.production` leaves blank.
 *
 * That last part is why this does not just call `dotenv.config` twice.
 * `dotenv` skips a variable that is already set, and it counts `NAME=` as
 * set - to the empty string. A name left blank in `.env.production` would
 * therefore shadow the filled one in `.env.development.local`, and the script
 * would run with an empty credential rather than an obviously missing one.
 * Emptiness has to be checked explicitly.
 *
 * Call this before importing anything that reads `process.env` at module
 * scope - `lib/firebase-admin` initialises the Admin SDK on import, so a
 * static import of it is evaluated first and comes up with no credentials.
 * That is why callers use a dynamic `await import()` after this.
 */
export function loadScriptEnv(): void {
  // Highest priority first. A real `process.env` value always wins.
  for (const file of [".env.production", ".env.development.local"]) {
    let parsed: Record<string, string>;
    try {
      parsed = dotenv.parse(readFileSync(file));
    } catch {
      continue; // Absent is fine; the caller reports what it actually needs.
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (value !== "" && !process.env[name]) process.env[name] = value;
    }
  }
}
