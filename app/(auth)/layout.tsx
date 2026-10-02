import { AppShell } from "@/components/system/app-shell";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell center>{children}</AppShell>;
}
