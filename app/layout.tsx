import { Geist, Geist_Mono, DM_Sans } from "next/font/google"

import "./globals.css"
import { AuthProvider } from "@/lib/auth-context"
import { cn } from "@/lib/utils";

const dmSans = DM_Sans({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata = {
  title: "Hotspot Manager",
  description: "Purchase internet vouchers online",
}

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
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
