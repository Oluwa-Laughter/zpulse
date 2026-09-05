"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEnvelope } from "./useEnvelope";
import { formatInt } from "@/lib/analysis/format";

import { useEffect, useState } from "react";
import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineBars3,
  HiOutlineXMark,
  HiOutlineHome,
  HiOutlineShieldCheck,
  HiOutlineMagnifyingGlass,
  HiOutlineServerStack,
  HiOutlineCommandLine,
} from "react-icons/hi2";
import { ZNodeSwitcherModal } from "./ZNodeSwitcherModal";
import { ZLogo } from "./ZLogo";

const LINKS = [
  { href: "/", label: "Dashboard", icon: HiOutlineHome },
  { href: "/observatory", label: "Observatory", icon: HiOutlineShieldCheck },
  { href: "/explorer", label: "Block Explorer", icon: HiOutlineMagnifyingGlass },
  { href: "/node", label: "Node Monitor", icon: HiOutlineServerStack },
  { href: "/rpc", label: "RPC Playground", icon: HiOutlineCommandLine },
];

export function ZNav() {
  const pathname = usePathname();
  const heightData = useEnvelope<{ height: number }>("/api/height", 10_000);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isDemo = heightData.meta?.mode === "demo";
  const isLive = heightData.meta?.source === "live" || heightData.meta?.source === "cache";
  const height = heightData.data?.height;
  const isError = Boolean(heightData.error);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <div className="z-nav-container">
        {/* Desktop Navigation Links */}
        <nav className="z-nav z-nav-desktop" aria-label="Main Navigation">
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

        {/* Right side actions: Node Pill & Mobile Hamburger */}
        <div className="z-nav-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="z-nav-status-pill"
            onClick={() => setIsSwitcherOpen(true)}
            title="Click to Switch Node: Interactive Demo, Local Zebra (8232), or 3rd-Party Remote RPC"
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

          {/* Mobile Hamburger Toggle Button */}
          <button
            type="button"
            className="z-mobile-nav-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <HiOutlineXMark style={{ fontSize: 22 }} />
            ) : (
              <HiOutlineBars3 style={{ fontSize: 22 }} />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu Overlay */}
      {mobileOpen && (
        <div className="z-mobile-nav-backdrop" onClick={() => setMobileOpen(false)}>
          <div
            className="z-mobile-nav-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation"
          >
            <div className="z-mobile-nav-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ZLogo size={22} showText={false} />
                <span style={{ fontWeight: 700, fontSize: 15 }}>ZPulse Menu</span>
              </div>
              <button
                type="button"
                className="z-btn-icon"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <HiOutlineXMark style={{ fontSize: 20 }} />
              </button>
            </div>

            {/* Navigation links list */}
            <nav className="z-mobile-nav-list">
              {LINKS.map((link) => {
                const Icon = link.icon;
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`z-mobile-nav-item ${isActive ? "z-active" : ""}`}
                    onClick={() => setMobileOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon style={{ fontSize: 18, color: isActive ? "var(--z-amber)" : "var(--z-text-muted)" }} />
                    <span style={{ flex: 1 }}>{link.label}</span>
                    {isActive && (
                      <span className="z-mobile-active-dot" />
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Mobile Node Switcher Card */}
            <div className="z-mobile-node-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`z-dot ${isError ? "z-down" : isDemo ? "z-demo" : isLive ? "z-live" : "z-cache"}`} />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {isError ? "Node Offline" : isDemo ? "Demo Sandbox" : "Live Mainnet Node"}
                  </span>
                </div>
                {height ? (
                  <span className="z-nav-status-height" style={{ fontSize: 11 }}>
                    #{formatInt(height)}
                  </span>
                ) : null}
              </div>

              <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--z-text-muted)", lineHeight: 1.4 }}>
                {isDemo
                  ? "Running built-in simulated Zebra dialect. Switch to Live Public Node or Local Node."
                  : "Connected live to Zcash network over JSON-RPC."}
              </p>

              <button
                type="button"
                className="z-btn z-btn-sm"
                onClick={() => {
                  setMobileOpen(false);
                  setIsSwitcherOpen(true);
                }}
                style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}
              >
                <HiOutlineAdjustmentsHorizontal style={{ fontSize: 14 }} />
                <span>Switch Node Connection</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Node Switcher Modal */}
      <ZNodeSwitcherModal
        isOpen={isSwitcherOpen}
        onClose={() => setIsSwitcherOpen(false)}
        onChanged={() => heightData.refresh()}
      />
    </>
  );
}

