import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope, Tenor_Sans } from "next/font/google";
import GoldCursor from "@/components/gold-cursor";
import "./globals.css";

const display = Cormorant_Garamond({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const sans = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

const accent = Tenor_Sans({
  subsets: ["latin", "cyrillic"],
  weight: "400",
  variable: "--font-accent",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aurelius — Universal AI Research Engine",
  description:
    "Bilingual responsive demo of a universal AI research and data acquisition engine.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${display.variable} ${sans.variable} ${accent.variable}`}>
      <body>
        {/* Shared gradient so line icons can be stroked in gold foil (see .icon-foil). */}
        <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="aurelius-foil" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff1c9" />
              <stop offset="45%" stopColor="#d9b46a" />
              <stop offset="100%" stopColor="#8f6a2c" />
            </linearGradient>
          </defs>
        </svg>
        {children}
        <GoldCursor />
      </body>
    </html>
  );
}
