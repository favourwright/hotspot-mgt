import { normalizeAccentColor, readableForeground, type EffectiveBranding } from "@/lib/branding";

interface PortalBrandHeaderProps {
  businessName: string;
  subtitle: string;
  /** Null for the default look: the plan lacks it, or nothing is saved. */
  branding: EffectiveBranding | null;
}

/**
 * The top of both portal routes: the tenant's logo if they have one, their
 * name, and a line saying what this page is for.
 *
 * The logo is a data URI written into the page, not a link to an image.
 * That costs no request, needs no walled-garden entry, and is cheap only
 * because lib/branding.ts keeps it to a few kilobytes.
 *
 * The accent colour replaces the theme's primary colour for the whole page,
 * through a style element rather than a wrapper's inline style, because the
 * checkout dialog renders in a portal at the end of the body and would not
 * inherit from a wrapper. `:root:root` outranks both the light `:root` and
 * the `.dark` rule in globals.css. The colour is re-normalized here, so
 * nothing but six hex digits is ever spliced into the stylesheet.
 */
export function PortalBrandHeader({
  businessName,
  subtitle,
  branding,
}: PortalBrandHeaderProps) {
  const accent = normalizeAccentColor(branding?.accentColor);

  return (
    <div className="text-center">
      {accent && (
        <style>{`:root:root{--primary:${accent};--primary-foreground:${readableForeground(accent)}}`}</style>
      )}
      {branding?.logo && (
        // eslint-disable-next-line @next/next/no-img-element -- a data URI; next/image would only add a wrapper
        <img
          src={branding.logo}
          alt=""
          className="mx-auto mb-3 size-16 object-contain"
        />
      )}
      <h1 className="text-3xl font-semibold tracking-tight">{businessName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
