import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FAR Calculator | Bangladesh Plot Assessment",
  description:
    "A data-driven plot FAR calculator for Bangladesh. Import verified planning rules and review transparent calculations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
