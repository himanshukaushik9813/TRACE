/**
 * Ecosystem technologies TRACE is built with. Shown in the launch intro under
 * "BUILT WITH ECOSYSTEM TECHNOLOGIES". No partnership, sponsorship or endorsement is
 * claimed or implied.
 *
 * Logos: TRACE never draws or approximates these marks. Each logo is the brand's own
 * official file, loaded from the brand's own host and displayed unmodified (no
 * recolouring, stretching, rotation or effects): uniform scaling only. `height` sets
 * a visually balanced size; `margin` only overlaps transparent canvas around the mark
 * (Ethereum's landscape file has wide built-in padding). The same official files are
 * self-hosted in public/brand/partners/<key>.svg (downloaded 2026-11-07 from the sources
 * below) and served from TRACE's own domain; the remote URL is the fallback. If a logo
 * fails to load, the card shows a plain text wordmark. See docs/BRAND_ASSETS.md.
 */

export type PartnerLogo = { src: string; height: number; margin?: string };

export type Partner = {
  key: "uniswap" | "ethereum" | "1inch" | "0g";
  name: string;
  /** What TRACE uses it for — a role, not an integration status. */
  role: string;
  /** Official asset page the file comes from. */
  source: string;
  logo: PartnerLogo;
};

export const PARTNERS: Partner[] = [
  {
    key: "uniswap",
    name: "Uniswap",
    role: "V3 liquidity data",
    source: "https://github.com/Uniswap/brand-assets (Uniswap Brand Assets / Uniswap_horizontallogo_pink.svg)",
    logo: { src: "https://raw.githubusercontent.com/Uniswap/brand-assets/main/Uniswap%20Brand%20Assets/Uniswap_horizontallogo_pink.svg", height: 22 },
  },
  {
    key: "ethereum",
    name: "Ethereum",
    role: "Sepolia testnet",
    source: "https://ethereum.org/en/assets/ (ETH logo landscape, transparent)",
    logo: { src: "https://ethereum.org/images/assets/svgs/ethereum-logo-landscape-black.svg", height: 92, margin: "-34px -32px" },
  },
  {
    key: "1inch",
    name: "1inch",
    role: "Aqua execution",
    source: "https://1inch.com/press-room (1inch wordmark black logo)",
    logo: { src: "https://1inch.com/assets/images/landing/press-room/assets/1inch_logo_black.svg", height: 25 },
  },
  {
    key: "0g",
    name: "0G",
    role: "AI compute & storage",
    source: "https://0g.ai/brandkit (Black ØG logo)",
    logo: { src: "https://0g.ai/assets/681c472ba991e2e4ca164fe6_Black-OG-Logo.svg", height: 18 },
  },
];

export const PARTNER_HEADING = "Built with ecosystem technologies";

/** Self-hosted logo files present in /public (resolved on the server, layout.tsx). Override the remote ones. */
export type PartnerLogos = Partial<Record<Partner["key"], string>>;
