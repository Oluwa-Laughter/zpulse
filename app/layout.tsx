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
              <span className="z-brand-tag">Zcash network observatory</span>
            </Link>
            <ZNav />
          </header>

          <main>{children}</main>

          <footer className="z-footer">
            <span>Built for the Zcash Foundation Sprint · Mini Build Challenge</span>
            <Link href="/rpc">16 RPC methods</Link>
            <a href="https://zechub.wiki/developers" target="_blank" rel="noreferrer">
              ZecHub developer docs
            </a>
          </footer>
        </div>
      </body>
    </html>
  );
}
