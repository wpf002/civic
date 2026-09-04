import type { Config } from "tailwindcss";

/**
 * Tokens live in globals.css as CSS variables; this maps them into Tailwind.
 * There is deliberately no party color, no blue primary, and no shadow scale —
 * depth in this product is a value step plus a rule, never a drop shadow.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "var(--ground)",
        surface: "var(--surface)",
        sunk: "var(--sunk)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
        "stance-strong": "var(--stance-strong)",
        "stance-soft": "var(--stance-soft)",
        mark: "var(--mark)",
        meter: "var(--meter)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // 375px baseline. Nothing informational below 13px; absence text is full body size.
        meta: ["12px", { lineHeight: "1.2", letterSpacing: "0.08em" }],
        caption: ["13px", { lineHeight: "1.45" }],
        base: ["16px", { lineHeight: "1.55" }],
        summary: ["17px", { lineHeight: "1.5" }],
        quote: ["19px", { lineHeight: "1.55" }],
        title: ["22px", { lineHeight: "1.3" }],
        question: ["24px", { lineHeight: "1.25" }],
        display: ["30px", { lineHeight: "1.15" }],
      },
      borderRadius: { DEFAULT: "2px", sm: "2px", md: "4px", lg: "4px" },
      maxWidth: { measure: "62ch" },
      boxShadow: { none: "none" },
    },
  },
  plugins: [],
} satisfies Config;
