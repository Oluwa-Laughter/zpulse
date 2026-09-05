import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ZNav } from "@/components/ZNav";
import { ZLogo } from "@/components/ZLogo";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0b0f17",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://zpulse-v1.vercel.app"),
  title: {
    default: "ZPulse — Zcash Network & Shielded Supply Intelligence",
    template: "%s | ZPulse",
  },
  description:
    "Real-time network telemetry, turnstile migration flows, shielded pool audit math, and JSON-RPC developer toolkit built on the official Zcash Foundation Zebra node.",
  keywords: [
    "Zcash",
    "Zcash Network",
    "Zebra",
    "zebrad",
    "Zcash Foundation",
    "Shielded Pools",
    "Turnstile Migration",
    "Sapling",
    "Orchard",
    "Sprout",
    "Ironwood",
    "Zero Knowledge",
    "JSON-RPC",
    "Block Explorer",
    "Cryptocurrency Observatory",
  ],
  authors: [{ name: "ZPulse Team" }],
  creator: "ZPulse",
  publisher: "ZPulse",
  applicationName: "ZPulse",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.svg", type: "image/svg+xml" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://zpulse-v1.vercel.app",
    siteName: "ZPulse",
    title: "ZPulse — Zcash Network & Shielded Supply Intelligence",
    description:
      "Real-time network telemetry, turnstile migration flows, shielded pool audit math, and JSON-RPC developer toolkit built on the official Zcash Foundation Zebra node.",
    images: [
      {
        url: "/icon.svg",
        width: 512,
        height: 512,
        alt: "ZPulse — Zcash Network & Shielded Supply Intelligence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZPulse — Zcash Network & Shielded Supply Intelligence",
    description:
      "Real-time network telemetry, turnstile migration flows, shielded pool audit math, and JSON-RPC developer toolkit built on the official Zcash Foundation Zebra node.",
    images: ["/icon.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "ZPulse",
  url: "https://zpulse-v1.vercel.app",
  description:
    "Real-time Zcash network observatory, shielded supply reconciliation, turnstile migration tracker, and JSON-RPC developer toolkit.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "All",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <div className="z-shell">
          <header className="z-header">
            <Link href="/" className="z-brand" aria-label="ZPulse Home">
              <ZLogo size={26} />
            </Link>
            <ZNav />
          </header>

          <main>{children}</main>

          <footer className="z-footer">
            <span>ZPulse · Zcash Network & Shielded Supply Observatory</span>
            <span>Direct JSON-RPC Connection to Zebra</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
