import React from "react";

interface ZLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function ZLogo({
  size = 28,
  showText = true,
  className = "",
}: ZLogoProps) {
  return (
    <div
      className={`z-logo-container ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        textDecoration: "none",
      }}
    >
      {/* Clean Minimalist Vector Mark (No Emoji) */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, display: "block" }}
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="8" fill="#F59E0B" />
        <path
          d="M9.5 9.5H22.5L9.5 22.5H22.5"
          stroke="#0B0F17"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Brand Name Typography */}
      {showText && (
        <span
          style={{
            fontWeight: 800,
            fontSize: size > 24 ? 21 : 18,
            letterSpacing: "-0.02em",
            color: "var(--z-text)",
            lineHeight: 1,
          }}
        >
          <span style={{ color: "var(--z-amber)" }}>Z</span>Pulse
        </span>
      )}
    </div>
  );
}
