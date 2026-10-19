import { Phone, MessageCircle } from "lucide-react";

import { formatLocalPhone, telHref, whatsappHref } from "@/lib/phone";

interface PortalSupportProps {
  /** E.164, or null when the tenant has not given one. Then nothing renders. */
  supportPhone: string | null;
  isWhatsapp: boolean;
  businessName: string;
}

/**
 * The venue's support line, at the foot of both portal routes.
 *
 * **The `tel:` link is the primary one on purpose.** Everybody reading this
 * page is behind the paywall with no internet, and a phone call rides the
 * cellular radio rather than the wifi, so it is the only channel here that
 * works unconditionally. WhatsApp is the secondary.
 *
 * The WhatsApp link opens the app through the `whatsapp://` scheme with the
 * message already written. It cannot be *sent* until the customer has data,
 * by finishing a purchase or switching to mobile - see `whatsappHref` in
 * lib/phone.ts for why we do not fix that by whitelisting WhatsApp.
 *
 * A muted line rather than a card. It is a fallback, and a card of its own
 * would put it in competition with Connect.
 */
export function PortalSupport({
  supportPhone,
  isWhatsapp,
  businessName,
}: PortalSupportProps) {
  if (!supportPhone) return null;

  const local = formatLocalPhone(supportPhone);

  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-muted-foreground">
      <span>Need help?</span>
      <a
        href={telHref(supportPhone)}
        className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
      >
        <Phone className="size-3.5 shrink-0" />
        0{local}
      </a>
      {isWhatsapp && (
        <a
          href={whatsappHref(
            supportPhone,
            `Hi, I need help getting online at ${businessName}.`
          )}
          className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
        >
          <MessageCircle className="size-3.5 shrink-0" />
          WhatsApp
        </a>
      )}
    </p>
  );
}
