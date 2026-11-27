/**
 * Made-up values for previewing an email and for the test send at
 * /superadmin/emails. Shaped like what the real call sites pass (money from
 * formatNaira, dates as text), so a preview shows the real line lengths.
 *
 * Keyed by variable name, not by email: most names mean the same thing in
 * every email that uses them. A name with no entry previews as `[name]`, so
 * a new variable is visible in the preview rather than blank.
 */

import { getEmailDefinition, type EmailKey } from "@/lib/email-catalog";

const BASE = (process.env.NEXT_PUBLIC_APP_URL || "https://example.com").replace(/\/$/, "");

const SAMPLES: Record<string, string> = {
  account_last4: "4821",
  action_url: `${BASE}/sample-hub/admin`,
  addon_name: "Captive portal",
  addons_url: `${BASE}/sample-hub/admin/addons`,
  admin_url: `${BASE}/sample-hub/admin`,
  amount: "₦2,500.00",
  attention: "1 voucher in the failed queue | 1 payment under review",
  bank_name: "Sample Bank",
  billing_note: "₦3,000.00 a month, charged monthly.",
  billing_url: `${BASE}/sample-hub/admin/settings`,
  business_name: "Sample Hub",
  current_count: "80",
  customer_email: "customer@example.com",
  data_limit: "5 GB",
  detail: "You now have 500 voucher generation credits.",
  devices: "2",
  duration: "1 day",
  email: "someone@example.com",
  effect: "Your hook is set to block, so purchases are being turned away until it answers.",
  endpoint_url: "https://example.com/webhooks/ogawifi",
  ends_at: "30 November 2026",
  expected_share: "₦2,250.00",
  expires_at: "28 November, 6:30 pm",
  failed_queue_url: `${BASE}/sample-hub/admin/failed`,
  failure_reason: "Router did not respond",
  grace_days: "3 days",
  gross_amount: "₦47,500.00",
  hook_name: "Member check",
  hooks_url: `${BASE}/sample-hub/admin/developers/hooks`,
  item: "Voucher generation credits",
  last_error: "Timed out after 3 seconds",
  last_seen: "27 November, 9:14 am",
  limit_type: "customer",
  limit_value: "100",
  location_breakdown: "Main hall: 12 vouchers, ₦30,000.00 | Cafe: 7 vouchers, ₦17,500.00",
  location_name: "Main hall",
  locked_since: "27 November 2026",
  locks_at: "3 December 2026",
  monthly_fee: "₦3,000.00",
  next_billing_date: "27 December 2026",
  owner_email: "owner@example.com",
  period: "Wednesday 26 November",
  plan_name: "Daily 5GB",
  platform_revenue: "₦4,750.00",
  portal_url: `${BASE}/sample-hub/portal`,
  previous_email: "old-address@example.com",
  reason: "Amount does not match",
  received_share: "₦2,000.00",
  reference: "OGW-SAMPLE-0001",
  reset_url: `${BASE}/auth/action?mode=resetPassword&oobCode=sample`,
  renewal_note: "The time and data you had left were added on top.",
  router_name: "Main hall router",
  settings_url: `${BASE}/sample-hub/admin/settings`,
  slug: "sample-hub",
  superadmin_url: `${BASE}/superadmin`,
  tenant_admin_url: `${BASE}/superadmin/tenants/sample`,
  tenant_breakdown: "Sample Hub: 19 vouchers, ₦47,500.00",
  tenant_count: "1",
  tenant_share: "₦2,250.00",
  verify_url: `${BASE}/auth/action?mode=verifyEmail&oobCode=sample`,
  voucher_count: "19",
  voucher_password: "k7m2p9",
  voucher_username: "hub-4f8q",
  vouchers_url: `${BASE}/sample-hub/admin/vouchers`,
  webhooks_url: `${BASE}/sample-hub/admin/developers/webhooks`,
};

export function sampleVariables(key: EmailKey): Record<string, string> {
  const definition = getEmailDefinition(key);
  const result: Record<string, string> = {};
  for (const name of definition?.variables ?? []) {
    result[name] = SAMPLES[name] ?? `[${name}]`;
  }
  return result;
}
