import { Check, Wifi } from "lucide-react";

import { cn } from "@/lib/utils";
import { HOW } from "@/lib/landing-content";
import { MediaCard } from "@/components/marketing/media-card";

/**
 * The buyer's side, as a customer meets it on a venue's own page.
 *
 * `aria-hidden` and non-interactive, like every other mock on this page:
 * the prices are illustrative and a plan you can appear to select but
 * not buy is worse than a picture of one. The steps beside it carry the
 * meaning.
 *
 * It floats on a `MediaCard` the same way the reference floats its mock
 * on a photograph - the gradient field is what we have instead of
 * photography, and reusing it keeps one visual vocabulary rather than
 * introducing a second kind of backdrop.
 */
export function PortalMock() {
  const { mock } = HOW;

  return (
    <div aria-hidden className="relative">
      <MediaCard tone="light" seed={1} className="absolute inset-0 rounded-surface" />

      <div className="relative p-6 sm:p-10">
        <div className="mx-auto max-w-sm rounded-panel bg-raised p-6 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.45)]">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background">
              <Wifi className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{mock.venue}</p>
              <p className="text-xs text-muted-foreground">{mock.prompt}</p>
            </div>
          </div>

          <ul className="mt-5 flex flex-col gap-2">
            {mock.options.map((option, index) => {
              const chosen = index === mock.selected;
              return (
                <li
                  key={option.label}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 transition-colors",
                    chosen ? "bg-foreground text-background" : "bg-sunken"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    {/* The selection affordance the real portal uses: a
                        filled check on the chosen row, an empty ring on
                        the others. */}
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full",
                        chosen
                          ? "bg-background text-foreground"
                          : "border-2 border-foreground/20"
                      )}
                    >
                      {chosen && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {option.label}
                      </span>
                      <span
                        className={cn(
                          "block truncate text-xs",
                          chosen ? "text-background/60" : "text-muted-foreground"
                        )}
                      >
                        {option.meta}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {option.price}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Styled as the accent pill rather than rendered as a real
              Button: it is a picture of a control, and a focusable
              element here would be a tab stop that does nothing. */}
          <p className="mt-5 grid h-11 place-items-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
            {mock.action}
          </p>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            {mock.note}
          </p>
        </div>
      </div>
    </div>
  );
}
