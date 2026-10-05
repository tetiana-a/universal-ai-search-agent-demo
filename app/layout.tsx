import type { Metadata } from "next";
import { Alegreya_Sans, Cormorant_Garamond } from "next/font/google";
import GoldCursor from "@/components/gold-cursor";
import LineReveal from "@/components/line-reveal";
import "./globals.css";

// The serif is kept only for the AURELIUS wordmark (see .brand-logo).
const logo = Cormorant_Garamond({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-logo-serif",
  display: "swap",
});

// Free web stand-in for Candara Light, used where Candara is not installed.
const humanist = Alegreya_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-humanist",
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
    <html lang="ru" className={`${logo.variable} ${humanist.variable}`}>
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
        <LineReveal />
      </body>
    </html>
  );
}
