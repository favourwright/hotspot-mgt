import type { Metadata } from "next"
import { Geist, Geist_Mono, DM_Sans } from "next/font/google"

import "./globals.css"
import faviconSvg from "@/public/favicon.svg"
import logoPng from "@/public/logo.png"
import logoSocial from "@/public/logo-social.png"
import { AuthProvider } from "@/providers/auth-provider"
import { QueryProvider } from "@/providers/query-provider"
import { BRAND } from "@/lib/landing-content"
import { SITE_URL } from "@/lib/seo"
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast"

const dmSans = DM_Sans({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  // Social crawlers need absolute image URLs.
  metadataBase: new URL(SITE_URL),
  title: BRAND,
  description: "Sell WiFi vouchers online from your MikroTik router, with instant delivery and automatic payouts.",
  // Private unless a page opts in with `indexable()`. See lib/seo.ts.
  robots: { index: false, follow: false },
  // Imported, not linked by path: see components/system/logo-mark.tsx. The PNGs
  // are for the consumers that cannot read SVG: iOS and social crawlers.
  icons: {
    icon: [{ url: faviconSvg.src, type: "image/svg+xml" }],
    apple: [{ url: logoPng.src, sizes: "1478x1478", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: BRAND,
    images: [{ url: logoSocial.src, width: 1200, height: 630, alt: `${BRAND} logo` }],
  },
  twitter: {
    card: "summary",
    images: [{ url: logoPng.src, alt: `${BRAND} logo` }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={cn("antialiased", fontMono.variable, "font-sans", dmSans.variable)}
    >
      <body>
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  )
}
