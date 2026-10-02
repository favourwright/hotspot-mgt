/**
 * Call this once to initialize the platform config
 * document in Firestore with default values.
 *
 * This happens automatically the first time
 * getPlatformConfig() is called - no manual
 * initialization needed.
 *
 * To update config at runtime, use:
 * PATCH /api/platform/config (superadmin only)
 *
 * Or update directly in Firebase Console at:
 * /platform/config
 */
export const PLATFORM_CONFIG_NOTE =
  "See /lib/platform-config.ts for config management";
