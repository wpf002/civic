import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three families, all open-licensed, chosen so the product reads as document
 * rather than dashboard. Serif carries the record — headings and every verbatim
 * quote — which is the strongest available signal that the candidate's words are
 * not our chrome. Public Sans is the US federal typeface. Mono is metadata only.
 */
const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  fallback: ["Georgia", "serif"],
});
const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: "Civic — see what they actually said",
  description:
    "Pick an issue and see where every candidate on your ballot stands, with the quote and the source. If a candidate hasn't said, we say so.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never lock zoom on a reading product.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ground text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-4 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
