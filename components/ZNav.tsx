"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEnvelope } from "./useEnvelope";
import { formatInt } from "@/lib/analysis/format";

import { useState } from "react";
import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import { ZNodeSwitcherModal } from "./ZNodeSwitcherModal";

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
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  const isDemo = heightData.meta?.mode === "demo";
  const isLive = heightData.meta?.source === "live" || heightData.meta?.source === "cache";
  const height = heightData.data?.height;
  const isError = Boolean(heightData.error);

  return (
    <>
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

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="z-nav-status-pill"
            onClick={() => setIsSwitcherOpen(true)}
            title="Click to Switch Node: Demo Mode, Local Zebra (8232), or 3rd-Party Cloud RPC"
            style={{ cursor: "pointer", background: "var(--z-bg-deep)", border: "1px solid var(--z-line)" }}
          >
            <span
              className={`z-dot ${isError ? "z-down" : isDemo ? "z-demo" : isLive ? "z-live" : "z-cache"}`}
              aria-hidden="true"
            />
            <span className="z-nav-status-label">
              {isError ? "Node Offline" : isDemo ? "Demo Sandbox" : "Live Node"}
            </span>
            {height ? (
              <span className="z-nav-status-height">
                #{formatInt(height)}
              </span>
            ) : null}
            <HiOutlineAdjustmentsHorizontal style={{ fontSize: 13, color: "var(--z-text-muted)", marginLeft: 2 }} />
          </button>
        </div>
      </div>

      <ZNodeSwitcherModal
        isOpen={isSwitcherOpen}
        onClose={() => setIsSwitcherOpen(false)}
        onChanged={() => heightData.refresh()}
      />
    </>
  );
}

