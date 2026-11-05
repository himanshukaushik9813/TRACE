import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TRACE — On-Chain Strategy Intelligence",
    template: "%s · TRACE",
  },
  description:
    "Reconstruct Uniswap V3 liquidity behaviour, reverse-engineer the strategy behind any wallet, validate it with backtests, and compile compatible rules into executable 1inch Aqua programs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="bg-ivory text-ink antialiased">{children}</body>
    </html>
  );
}
