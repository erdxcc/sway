import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sway — own the moment belief moved",
    template: "%s — Sway",
  },
  description:
    "A mobile second-screen app that renders a live football match as a field of " +
    "light driven by the market's belief curve — then lets you capture the exact, " +
    "on-chain-verified moment belief swung.",
  applicationName: "Sway",
  authors: [{ name: "Sway" }],
};

export const viewport: Viewport = {
  themeColor: "#07070b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // The field is full-bleed; lock zoom so the canvas maps 1:1 to the viewport.
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
