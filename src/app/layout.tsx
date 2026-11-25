import type { Metadata, Viewport } from "next";
import { Didact_Gothic } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Brand font is Century Gothic (licensed, used from the device when installed, see globals.css).
// Didact Gothic is the closest free match, self-hosted by next/font for phones that lack it.
const gothic = Didact_Gothic({ subsets: ["latin"], weight: "400", variable: "--font-didact", display: "swap" });

const description =
  "Free Dhaka FAR calculator by Foundrio Design & Consultant. See the floor area, storeys, apartments and parking allowed on your plot under RAJUK DAP 2022–2035 and Building Rules 2025.";

export const metadata: Metadata = {
  title: "FAR Calculator Dhaka: How much can I build? | Foundrio",
  description,
  openGraph: {
    title: "How much can you build on your plot? | Foundrio FAR Calculator",
    description,
    siteName: "Foundrio",
    type: "website",
    locale: "en_BD",
  },
};

export const viewport: Viewport = { themeColor: "#173b2d" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={gothic.variable}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
