import { AppShell } from "@/components/system/app-shell";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Not `center`: the page opens with a band in the nav's slot, and the
  // form centres itself in what's left. Default measure, so the band spans
  // exactly the width a nav bar would on every other page.
  return <AppShell>{children}</AppShell>;
}
