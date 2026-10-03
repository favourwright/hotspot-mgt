/**
 * WireGuard registration: the flow's shape and its pure helpers.
 * Kept apart from the dialog so neither the step table nor the script
 * builder needs the component to be mounted to be read or tested.
 */

export type ConnectionMode = "wireguard" | "direct";
export type WgPhase = "details" | "connect" | "finish" | "verify";

// `verify` is a sub-state of the final step, not a fourth one -- it shares
// step 3 so the indicator doesn't appear to gain a step mid-flow.
export const WG_STEPS: Record<WgPhase, { step: number; label: string }> = {
  details: { step: 1, label: "Router details" },
  connect: { step: 2, label: "Connect your router" },
  finish: { step: 3, label: "Finish setup" },
  verify: { step: 3, label: "Verifying connection" },
};

export const WG_TOTAL_STEPS = 3;

// Generates a per-registration-attempt WireGuard interface name/port - never
// hardcoded, so a fresh attempt can't collide with anything already on the
// tenant's router (their own unrelated VPN, or a leftover from an earlier
// attempt). See docs/wireguard-interface-collision-fix.md.
export function generateWireGuardIdentity(): { interfaceName: string; listenPort: number } {
  const suffix =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return {
    interfaceName: `wg-hm-${suffix}`,
    listenPort: 20000 + Math.floor(Math.random() * 10000),
  };
}

// Self-contained pre-flight check the user runs on the router before we
// change anything - catches the two most common reasons this setup would
// fail (RouterOS too old, or something already using this attempt's
// interface name/port) and prints a plain READY/NOT READY result so a
// non-technical user doesn't have to interpret raw command output.
export function buildReadinessCheckScript(interfaceName: string, listenPort: number): string {
  // Wrapped in one outer { } so the whole thing runs as a single atomic
  // block when pasted into an interactive terminal - without it, RouterOS
  // executes each unbracketed :local line as its own separate command and
  // forgets the variable before the :if block below ever sees it.
  return `{
:local ver [:tostr [/system/resource get version]]
:local hasWg [:len [/interface/wireguard find name=${interfaceName}]]
:local hasPort [:len [/interface/wireguard find listen-port=${listenPort}]]
:if ([:pick $ver 0 1] != "7") do={
  :put ("NOT READY - RouterOS " . $ver . " is too old. WireGuard needs RouterOS 7 or newer.")
} else={
  :if ($hasWg > 0 or $hasPort > 0) do={
    :put "NOT READY - Something is already using this connection name/port. Try generating a new connection name below."
  } else={
    :put "READY - You can safely continue to the next step."
  }
}
}`;
}
