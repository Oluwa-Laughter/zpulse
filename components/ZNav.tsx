"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEnvelope } from "./useEnvelope";
import { formatInt } from "@/lib/analysis/format";

import { HiOutlineArrowPath } from "react-icons/hi2";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/observatory", label: "Observatory" },
  { href: "/explorer", label: "Block Explorer" },
  { href: "/node", label: "Node Monitor" },
  { href: "/rpc", label: "RPC Playground" },
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

      <Link href="/node" className="z-nav-status-pill" title="View Node Diagnostics and Connection">
        <span
          className={`z-dot ${isError ? "z-down" : isDemo ? "z-demo" : isLive ? "z-live" : "z-cache"}`}
          aria-hidden="true"
        />
        <span className="z-nav-status-label">
          {isError ? "Node Offline" : isDemo ? "Zebra Emulator" : "Zebra Node"}
        </span>
        {height ? (
          <span className="z-nav-status-height">
            #{formatInt(height)}
          </span>
        ) : null}
      </Link>
    </div>
  );
}

