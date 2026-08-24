import type { Metadata } from "next";
import Link from "next/link";
import { ZNav } from "@/components/ZNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZPulse — Zcash network observatory",
  description:
    "Live Zcash shielded-supply integrity, turnstile flow and per-block privacy mix, read directly from a Zcash node over JSON-RPC.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="z-shell">
          <header className="z-header">
            <Link href="/" className="z-brand">
              <span>
                <span className="z-brand-z">Z</span>Pulse
              </span>
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
