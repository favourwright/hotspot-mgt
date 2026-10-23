"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import type { PurchaseIntent } from "@/lib/voucher-renewal";

/**
 * The one question a repeat purchase has to ask: is this for you, or for
 * someone else?
 *
 * It exists because the answer cannot be worked out from anything we know.
 * On the day renewal shipped, a customer bought the same daily plan three
 * times in nineteen minutes meaning to hand two of the codes to friends,
 * and all three stacked onto his own login. From the outside that is
 * indistinguishable from someone topping themselves up, which is why this
 * is a question and not a heuristic.
 *
 * ## Why it looks like this
 *
 * Shaped after the router dialog, which is the most carefully built flow in
 * the app, and takes three things from it:
 *
 *  - **It only appears when there is genuinely something to decide.** The
 *    router dialog does not show the direct-IP fields to someone using
 *    WireGuard. This renders nothing at all for a first purchase, or when
 *    everything the buyer holds is already busy, which is most of the time.
 *  - **Consequences in plain words, not labels.** "Adds 1 Day to
 *    FAVOUR-7K2P, running to Mon 20 Oct" rather than "Renew". The router
 *    dialog says "most routers just need a couple of commands pasted into
 *    their terminal. Takes about 5 minutes" for the same reason: the person
 *    reading it should not have to model the system to predict what the
 *    button does.
 *  - **Two options, never three.** Topping up a running plan and reviving a
 *    dead code are mutually exclusive by construction - one needs the login
 *    busy, the other needs it free - so the server picks which flavour of
 *    "mine" applies and the buyer only ever sees the question they can
 *    actually answer.
 *
 * The cards themselves are the onboarding plan picker's
 * (`components/onboarding/step-choose-plan.tsx`), down to the tick badge
 * and the `bg-foreground/85` selected fill. Picking one of a few things is
 * the same act in both places and there is no reason it should look like
 * two different controls.
 *
 * Nothing is preselected, which is deliberate and costs one tap. An
 * invisible automatic decision is what caused the incident, and this is the
 * exact moment it was made.
 */

export interface ReuseOptionView {
  mode: "extend" | "revive";
  username: string;
  currentExpiresAt: string | null;
  newExpiresAt: string | null;
  previousPlanName: string | null;
  /** The tenant's renewal rules; see `Tenant.renewalExpiryMode`. */
  expiryMode?: "extend" | "reset";
  dataMode?: "carry" | "reset";
}

export interface PurchaseOptionsView {
  reuse: ReuseOptionView | null;
  hasUnusedVoucher: boolean;
}

export function PurchaseIntentChoice({
  options,
  value,
  onChange,
  planDuration,
}: {
  options: PurchaseOptionsView | null;
  value: PurchaseIntent | null;
  onChange: (intent: PurchaseIntent) => void;
  planDuration: string;
}) {
  const reuse = options?.reuse;
  if (!reuse) return null;

  const resetsExpiry = reuse.expiryMode === "reset";
  const resetsData = reuse.dataMode === "reset";

  // Whether starting the clock again actually takes something off them.
  // Renewing on the last afternoon of a plan loses minutes nobody would
  // call a loss; renewing a weekly plan on day two loses five days, and
  // that is the sentence this component exists to say out loud.
  const losesTime =
    resetsExpiry &&
    reuse.currentExpiresAt !== null &&
    reuse.newExpiresAt !== null &&
    new Date(reuse.newExpiresAt).getTime() <
      new Date(reuse.currentExpiresAt).getTime();

  const mine =
    reuse.mode === "extend"
      ? {
          title: "Me",
          detail: resetsExpiry
            ? reuse.newExpiresAt
              ? `Starts ${reuse.username} again at ${planDuration}, running to ${formatDate(reuse.newExpiresAt)}`
              : `Starts ${reuse.username} again at ${planDuration}`
            : reuse.newExpiresAt
              ? `Adds ${planDuration} to ${reuse.username}, running to ${formatDate(reuse.newExpiresAt)}`
              : `Adds ${planDuration} to ${reuse.username}`,
        }
      : {
          title: "Me",
          detail: reuse.previousPlanName
            ? `Puts it on ${reuse.username}, your old ${reuse.previousPlanName} code`
            : `Puts it on ${reuse.username}, the login you already have`,
        };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Who is this for?</h3>
        <p className="text-muted-foreground text-sm">
          {reuse.mode === "extend"
            ? resetsExpiry
              ? "You already have this plan running. Buying it again can start it again, or make a separate code."
              : "You already have this plan running. Buying it again can add to it, or make a separate code."
            : "You already have a login here. This can go on it, or be a separate code."}
        </p>
      </div>

      <div className="space-y-2">
        <IntentOption
          selected={value === "reuse"}
          title={mine.title}
          detail={mine.detail}
          onClick={() => onChange("reuse")}
        />
        <IntentOption
          selected={value === "fresh"}
          title="Someone else"
          detail="A separate code, created when you pay. Nothing you have changes."
          onClick={() => onChange("fresh")}
        />
      </div>

      {/*
        Said before the money moves, not after. Under the tenant's reset
        settings a renewal replaces what the customer has left rather than
        adding to it, and a buyer who was shown only the new date would have
        no way to tell that their remaining days had been spent on it.
      */}
      {reuse.mode === "extend" && (losesTime || resetsData) && (
        <p className="text-muted-foreground text-sm">
          {losesTime && reuse.currentExpiresAt
            ? `Your current plan runs to ${formatDate(reuse.currentExpiresAt)}. Renewing now replaces that rather than adding to it.`
            : null}
          {losesTime && resetsData ? " " : null}
          {resetsData
            ? "Any data you have left is replaced by this plan's allowance."
            : null}
        </p>
      )}
    </div>
  );
}

/**
 * A notice, not a gate.
 *
 * Holding an unused code for this plan used to refuse the sale outright.
 * That was the same wrong guess from the other side: buying a code for
 * somebody else is an ordinary purchase whatever is sitting unused in your
 * own inbox. So they are told, and allowed through.
 */
export function UnusedVoucherNotice({
  options,
}: {
  options: PurchaseOptionsView | null;
}) {
  if (!options?.hasUnusedVoucher || options.reuse) return null;

  return (
    <p className="text-muted-foreground text-sm">
      You already have a code for this plan that has not been used yet. This
      purchase makes a separate one, so use the first if it was meant for
      you.
    </p>
  );
}

function IntentOption({
  selected,
  title,
  detail,
  onClick,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    // A real button with `aria-pressed`, not a bordered div: the selected
    // state is carried by the surface, exactly as in the onboarding plan
    // picker this is lifted from. The opacities are load-bearing there and
    // kept as-is - a hover below ~10% black reads as the surface rather
    // than as a hover, and the selected fill stays off full black so it
    // sits under the dialog's own action.
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1 rounded-4xl p-4 text-left transition-colors",
        selected
          ? "bg-foreground/85 text-background"
          : "bg-foreground/3 hover:bg-foreground/5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full transition-colors",
            selected ? "bg-background text-foreground" : "bg-sunken text-transparent"
          )}
        >
          <Check className="size-3" />
        </span>
      </div>
      <span
        className={cn(
          "text-sm",
          selected ? "text-background/70" : "text-muted-foreground"
        )}
      >
        {detail}
      </span>
    </button>
  );
}
