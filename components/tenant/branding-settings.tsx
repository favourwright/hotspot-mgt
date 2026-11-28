"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { apiClient } from "@/lib/api-client";
import {
  LOGO_MAX_BYTES,
  LOGO_TARGET_SIZE,
  normalizeAccentColor,
  readableForeground,
} from "@/lib/branding";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

interface BrandingSettingsProps {
  initial: { logo: string | null; accentColor: string | null };
  /** Whether the tenant's billing plan includes custom branding. */
  included: boolean;
  /** False for a superadmin viewing someone else's settings. */
  canEdit: boolean;
  businessName: string;
}

/** Decoded size of a base64 data URI, without decoding it. */
function dataUriBytes(uri: string): number {
  const b64 = uri.slice(uri.indexOf(",") + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be opened as an image."));
    };
    img.src = url;
  });
}

/**
 * Scale the logo to the size the portal shows it at, then find the
 * smallest encoding that fits under the cap.
 *
 * PNG is preferred whenever it fits: it is lossless and every captive
 * portal browser shows it, including the old Android ones that may not
 * show WebP. WebP at falling quality is the fallback for logos too
 * detailed for PNG to fit. Safari before 17 cannot encode WebP from a
 * canvas and quietly returns PNG instead, which the prefix check catches.
 * If nothing fits, the image is shrunk a step and tried again.
 *
 * Anything the browser can draw is accepted as input, SVG included,
 * because what comes out is always raster: the canvas is the sanitizer.
 */
async function compressLogo(file: File): Promise<string> {
  const img = await loadImage(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error("That image has no size. Try a PNG or JPEG.");

  // Fitted inside a square, aspect kept: a square mark fills it, a wide
  // wordmark is letterboxed, the same as every place it is shown.
  const base = Math.min(1, LOGO_TARGET_SIZE / h0, LOGO_TARGET_SIZE / w0);

  for (const shrink of [1, 0.85, 0.7, 0.55]) {
    const width = Math.max(1, Math.round(w0 * base * shrink));
    const height = Math.max(1, Math.round(h0 * base * shrink));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not process that image.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    const png = canvas.toDataURL("image/png");
    if (dataUriBytes(png) <= LOGO_MAX_BYTES) return png;

    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const webp = canvas.toDataURL("image/webp", quality);
      if (!webp.startsWith("data:image/webp")) break;
      if (dataUriBytes(webp) <= LOGO_MAX_BYTES) return webp;
    }
  }

  throw new Error(
    "That logo is too detailed to fit. Try a simpler version, such as one with fewer colours or no background photo."
  );
}

/**
 * The tenant's logo and accent colour on their captive portal.
 *
 * The logo is shrunk in the browser before it is sent, to fit a 96px square
 * and a few kilobytes (lib/branding.ts says why so small). The server
 * checks all of it again; this is what makes a normal upload pass those
 * checks first time.
 *
 * On a plan without custom branding the controls stay visible but
 * disabled, with a pointer to changing plan, except "Remove": taking
 * branding down is never gated.
 */
export function BrandingSettings({
  initial,
  included,
  canEdit,
  businessName,
}: BrandingSettingsProps) {
  const [logo, setLogo] = useState(initial.logo);
  const [accent, setAccent] = useState(initial.accentColor ?? "");
  const [saved, setSaved] = useState(initial);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const typedAccent = accent.trim();
  const normalizedAccent = typedAccent ? normalizeAccentColor(typedAccent) : null;
  const accentInvalid = typedAccent.length > 0 && !normalizedAccent;

  const dirty =
    logo !== saved.logo || (normalizedAccent ?? null) !== (saved.accentColor ?? null);
  const clearing = logo === null && normalizedAccent === null;
  const editable = canEdit && !saving && !processing;
  // Adding needs the plan feature; taking everything down never does.
  const canSave = canEdit && dirty && !accentInvalid && (included || clearing);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      setLogo(await compressLogo(file));
    } catch (error) {
      toast.add({
        title: "Could not use that image",
        description: error instanceof Error ? error.message : "Try another image.",
        type: "error",
      });
    } finally {
      setProcessing(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await apiClient.patch("/api/admin/branding", {
        logo,
        accentColor: normalizedAccent,
      });
      setSaved({ logo, accentColor: normalizedAccent });
      setAccent(normalizedAccent ?? "");
      // Re-renders the tenant layout, so the nav tile shows the new logo.
      router.refresh();
      toast.add({
        title: "Branding saved",
        description:
          "Your sign-in page shows it now. The pages on your routers update within 15 minutes.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not save that",
        description:
          error instanceof Error ? error.message : "Your branding is unchanged. Try again.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const previewAccent = normalizedAccent;

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Branding</SurfaceCardTitle>
        <SurfaceCardDescription>
          Your logo and colour on the Wi-Fi sign-in page.
        </SurfaceCardDescription>
      </SurfaceCardHeader>

      <SurfaceCardContent className="space-y-4">
        {!included && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your plan does not include custom branding. Change plan from the
              Billing plan section above to add your logo and colour.
              {saved.logo || saved.accentColor
                ? " Your saved branding is kept and comes back on a plan that includes it. You can still remove it."
                : ""}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 border-b pb-4">
          <Label className="text-sm font-medium">Logo</Label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white p-2">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data URI preview
                <img
                  src={logo}
                  alt="Your logo"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">No logo</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                className="hidden"
                onChange={onFile}
              />
              <Button
                tone="field"
                scale="sm"
                disabled={!editable || !included}
                onClick={() => fileInput.current?.click()}
              >
                {processing ? "Processing..." : logo ? "Replace" : "Upload logo"}
              </Button>
              {logo && (
                <Button
                  tone="ghost"
                  scale="sm"
                  disabled={!editable}
                  onClick={() => setLogo(null)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
          <p className="max-w-xl text-xs text-muted-foreground">
            {logo
              ? `Stored at ${formatKb(dataUriBytes(logo))}. `
              : ""}
            Shown in a square above your business name. We shrink it to load
            quickly on a connection customers have not paid for yet, so a
            simple square logo on a transparent background works best.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="brand-accent" className="text-sm font-medium">
            Accent colour
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              aria-label="Pick a colour"
              className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed"
              value={normalizedAccent ?? "#c6005c"}
              disabled={!editable || !included}
              onChange={(event) => setAccent(event.target.value)}
            />
            <Input
              id="brand-accent"
              className="w-32 font-mono"
              placeholder="#c6005c"
              value={accent}
              disabled={!editable || !included}
              aria-invalid={accentInvalid || undefined}
              onChange={(event) => setAccent(event.target.value)}
            />
            {typedAccent && (
              <Button
                tone="ghost"
                scale="sm"
                disabled={!editable}
                onClick={() => setAccent("")}
              >
                Use default
              </Button>
            )}
          </div>
          <p className="max-w-xl text-xs text-muted-foreground">
            {accentInvalid
              ? "Enter the colour as a hex code, like #1d4ed8."
              : "Used for buttons and the data bar. Button text switches between white and black to stay readable."}
          </p>
        </div>

        {(logo || previewAccent) && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="mb-3 text-xs text-muted-foreground">Preview</p>
            <div className="mx-auto max-w-xs rounded-lg bg-white p-4 text-center text-neutral-900">
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element -- a data URI preview
                <img src={logo} alt="" className="mx-auto mb-2 size-16 object-contain" />
              )}
              <p className="text-lg font-semibold">{businessName}</p>
              <div
                className="mt-3 rounded-md py-2 text-sm font-semibold"
                style={{
                  background: previewAccent ?? "#c6005c",
                  color: previewAccent ? readableForeground(previewAccent) : "#fdf2f8",
                }}
              >
                Connect
              </div>
            </div>
          </div>
        )}
      </SurfaceCardContent>

      {canEdit && (
        <SurfaceCardFooter>
          <Button tone="field" scale="sm" onClick={save} disabled={saving || !canSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </SurfaceCardFooter>
      )}
    </SurfaceCard>
  );
}
