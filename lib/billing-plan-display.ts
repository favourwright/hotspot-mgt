import { formatNaira } from "@/lib/utils";
import { API_ACCESS_ADDON } from "@/lib/addon-catalog";

/**
 * How a billing plan is described to someone who has not bought it yet.
 *
 * Shared by the onboarding plan picker and the landing page's pricing
 * section, which show the same plans to the same person a few minutes
 * apart. Keeping the labels in one place is the difference between those
 * two staying in step and quietly disagreeing the first time a feature
 * flag is added to the schema and only one of them learns about it.
 *
 * Structural parameter types rather than `BillingPlan`, because the
 * onboarding flow receives a trimmed, serialized shape over its API
 * route and the landing page reads the full document from Firestore.
 * Both satisfy what is needed here, and neither has to convert.
 */

export interface PlanLimitsShape {
  maxLocations: number | null;
  maxRouters: number | null;
  maxCustomers: number | null;
}

export interface PlanFeaturesShape {
  customBranding: boolean;
  prioritySupport: boolean;
}

export const FEATURE_LABELS: {
  key: keyof PlanFeaturesShape;
  label: string;
}[] = [
  { key: "customBranding", label: "Custom branding" },
  { key: "prioritySupport", label: "Priority support" },
];

/**
 * Bundled addons worth a line on a plan card. API access used to be a
 * boolean feature; it is now the `api-access` addon, and a plan that bundles
 * it still says so in the same words.
 */
export function addonBullets(includedAddons: readonly string[] | undefined): string[] {
  return includedAddons?.includes(API_ACCESS_ADDON) ? ["API access"] : [];
}

/**
 * Plan fees are always whole naira, and the ".00" `formatNaira` appends
 * is what pushes a four-figure price past the edge of a narrow card.
 */
export function formatPlanFee(kobo: number): string {
  return formatNaira(kobo).replace(/\.00$/, "");
}

const LIMIT_LABELS: {
  key: keyof PlanLimitsShape;
  singular: string;
  plural: string;
}[] = [
  { key: "maxLocations", singular: "location", plural: "locations" },
  { key: "maxRouters", singular: "router", plural: "routers" },
  { key: "maxCustomers", singular: "customer", plural: "customers" },
];

/**
 * Everything a plan card lists under "what's included".
 *
 * Caps come first. They are the part someone is most likely to be
 * disqualified by, so burying them under the marketing bullets would be
 * the wrong way round - the same order the onboarding card uses.
 *
 * `null` on a limit means no cap, which is a real selling point and is
 * said out loud rather than left off. A disabled boolean feature is the
 * opposite: the absence of a selling point, not a line that reads "no
 * API access", so only the enabled ones appear.
 */
export function planBullets(plan: {
  limits: PlanLimitsShape;
  features: PlanFeaturesShape;
  featureList: readonly string[];
  includedAddons?: readonly string[];
}): string[] {
  const limits = LIMIT_LABELS.map(({ key, singular, plural }) => {
    const cap = plan.limits?.[key];
    return cap === null || cap === undefined
      ? `Unlimited ${plural}`
      : `Up to ${cap} ${cap === 1 ? singular : plural}`;
  });

  const flags = FEATURE_LABELS.filter(({ key }) => plan.features?.[key]).map(
    ({ label }) => label
  );

  return [...limits, ...plan.featureList, ...flags, ...addonBullets(plan.includedAddons)];
}
