import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aurelius — Universal AI Research Engine",
  description:
    "Bilingual responsive demo of a universal AI research and data acquisition engine.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
