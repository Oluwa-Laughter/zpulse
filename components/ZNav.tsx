"use client";

/**
 * Site navigation.
 *
 * A client component only so the active link can be marked with `aria-current`
 * from `usePathname` — the rest of the layout stays a server component.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/observatory", label: "Observatory" },
  { href: "/node", label: "Node" },
  { href: "/rpc", label: "RPC console" },
];

export function ZNav() {
  const pathname = usePathname();

  return (
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
  );
}
