import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LaunchIntro } from "@/components/launch/launch-intro";
import { INTRO_BOOT_SCRIPT } from "@/lib/intro";
import { PARTNERS, type PartnerLogos } from "@/lib/partners";

/**
 * Official partner logo files present in public/brand/partners (see docs/BRAND_ASSETS.md).
 * Resolved on the server at build/render time; a missing file means a text wordmark.
 */
function partnerLogos(): PartnerLogos {
  const out: PartnerLogos = {};
  for (const p of PARTNERS) {
    for (const ext of ["svg", "png", "webp"]) {
      const rel = `/brand/partners/${p.key}.${ext}`;
      if (existsSync(join(process.cwd(), "public", rel))) {
        out[p.key] = rel;
        break;
      }
    }
  }
  return out;
}

// Interface + data: IBM Plex Sans (engineered for dense, numeric UI). Hashes and
// addresses: IBM Plex Mono. The serif is kept for the TRACE wordmark only.
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const wordmark = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
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

/** Static star for the pre-paint cover (same path as the TRACE mark). */
const COVER_STAR =
  "M 12 2 Q 14 10 22 12 Q 14 14 12 22 Q 10 14 2 12 Q 10 10 12 2 Z";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-intro* attributes are set before paint by the boot script and by <LaunchIntro>.
    <html lang="en" className={`${plex.variable} ${plexMono.variable} ${wordmark.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
      </head>
      <body className="bg-ivory text-ink antialiased">
        <div id="trace-intro-cover" aria-hidden="true">
          <div className="cover-mark flex-col items-center">
            <span className="grid place-items-center rounded-md2 border border-gold/35 bg-ivory-50 shadow-soft" style={{ width: 52, height: 52 }}>
              <svg viewBox="0 0 24 24" width={32} height={32}>
                <path d={COVER_STAR} fill="#B68A42" />
              </svg>
            </span>
            <div className="wordmark mt-3 leading-none tracking-[0.18em] text-ink text-[2.6rem]">TRACE</div>
          </div>
        </div>
        <Providers>
          <div id="trace-app">{children}</div>
          <LaunchIntro logos={partnerLogos()} />
        </Providers>
      </body>
    </html>
  );
}
