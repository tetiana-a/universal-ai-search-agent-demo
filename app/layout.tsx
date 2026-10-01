import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Aurelius — Universal AI Search Agent",description:"Bilingual AI research engine demo"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>}
