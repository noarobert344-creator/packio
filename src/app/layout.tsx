import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import "./globals.css";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "Packio — Votre logistique e-commerce, déléguée", template: "%s · Packio" },
  description:
    "Packio confie la réception, le stockage et l'expédition de vos commandes à un préparateur attitré. Pour les vendeurs e-commerce, revendeurs et entrepreneurs.",
  applicationName: "Packio",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Packio",
    title: "Packio — Votre logistique e-commerce, déléguée",
    description: "Un préparateur attitré réceptionne, stocke et expédie vos commandes. Vous suivez tout depuis votre tableau de bord.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#121318",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className={`dark ${GeistSans.variable} ${GeistMono.variable}`} style={{ colorScheme: "dark" }}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
