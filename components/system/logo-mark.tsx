import logo from "@/public/logo.svg";

import { cn } from "@/lib/utils";

/**
 * OgaWiFi's own mark, for the platform's brand only. Tenants keep their
 * generated tile (see TopNav).
 *
 * Imported rather than linked as `/logo.svg`: the deploy ships `.next/` and not
 * `public/`, and `proxy.ts` rewrites a root path on a tenant subdomain to that
 * tenant. An import lands in `.next/static`, which avoids both.
 *
 * Always on white: the mark is near-black, and sits on dark surfaces in the
 * docs sidebar and in dark mode. Size and corners come from `className`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img src={logo.src} alt="" className={cn("shrink-0 bg-white", className)} />
  );
}
