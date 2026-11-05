import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

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
    "Reconstruct real Uniswap V3 liquidity behaviour on Ethereum Sepolia, infer the strategy behind a wallet from on-chain evidence, backtest it on real pool swaps, and ship compatible rules as a 1inch Aqua strategy signed by your own wallet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="bg-ivory text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
