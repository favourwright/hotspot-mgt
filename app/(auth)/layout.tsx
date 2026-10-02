import { AppShell } from "@/components/system/app-shell";
import { CONTENT_WIDTHS } from "@/components/system/widths";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Not `center`: the page opens with a band in the nav's slot, and the
  // form centres itself in what's left. Capped narrow so the band and the
  // form read as one column rather than a wide header over a small card.
  return <AppShell className={CONTENT_WIDTHS.prose}>{children}</AppShell>;
}
