/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        zamber: {
          DEFAULT: "#f4b728",
          light: "#fbbf24",
          dark: "#d97706",
          glow: "rgba(244, 183, 40, 0.15)",
        },
        zbg: {
          DEFAULT: "#0b0f19",
          deep: "#070a10",
          card: "#111726",
          panel: "#151c2e",
          hover: "#1c253d",
        },
        zborder: {
          DEFAULT: "#1f293d",
          light: "#2a3752",
        },
        ztext: {
          DEFAULT: "#f8fafc",
          dim: "#cbd5e1",
          muted: "#94a3b8",
          faint: "#64748b",
        },
        zgood: "#10b981",
        zwarn: "#f59e0b",
        zbad: "#ef4444",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px",
        card: "10px",
      },
    },
  },
  plugins: [],
};
