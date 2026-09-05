import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZPulse — Zcash Network & Shielded Supply Intelligence",
    short_name: "ZPulse",
    description:
      "Real-time network telemetry, turnstile migration flows, shielded pool audit math, and JSON-RPC developer toolkit built on the official Zcash Foundation Zebra node.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f17",
    theme_color: "#0b0f17",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
