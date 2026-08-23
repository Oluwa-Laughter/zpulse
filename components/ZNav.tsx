"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEnvelope } from "./useEnvelope";
import { formatInt } from "@/lib/analysis/format";

import { HiOutlineArrowPath } from "react-icons/hi2";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/observatory", label: "Observatory" },
  { href: "/node", label: "Node & Sync" },
  { href: "/rpc", label: "RPC Console" },
];

export function ZNav() {
  const pathname = usePathname();
  const heightData = useEnvelope<{ height: number }>("/api/height", 10_000);

  const isDemo = heightData.meta?.mode === "demo";
  const isLive = heightData.meta?.source === "live" || heightData.meta?.source === "cache";
  const height = heightData.data?.height;
  const isError = Boolean(heightData.error);

  return (
    <div className="z-nav-container">
      <nav className="z-nav">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="z-row" style={{ gap: 8 }}>
        <button
          type="button"
          className="z-btn z-btn-sm"
          onClick={() => heightData.refresh()}
          title="Fetch latest block height and chain status"
          style={{ padding: "5px 11px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <HiOutlineArrowPath className={heightData.refreshing ? "z-spin" : ""} style={{ fontSize: 14 }} />
          <span>Refresh</span>
        </button>

        <Link href="/node" className="z-nav-status-pill" title="View Node Diagnostics and Connection">
          <span
            className={`z-dot ${isError ? "z-down" : isDemo ? "z-demo" : isLive ? "z-live" : "z-cache"}`}
            aria-hidden="true"
          />
          <span className="z-nav-status-label">
            {isError ? "Node Disconnected" : isDemo ? "Zebra Emulator" : "Zebra Node"}
          </span>
          {height ? (
            <span className="z-nav-status-height">
              #{formatInt(height)}
            </span>
          ) : null}
        </Link>
      </div>
    </div>
  );
}

