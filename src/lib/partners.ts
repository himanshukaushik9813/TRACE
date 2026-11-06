/**
 * Ecosystem technologies TRACE is built with. Shown in the launch intro under
 * "BUILT WITH ECOSYSTEM TECHNOLOGIES". No partnership, sponsorship or endorsement is
 * claimed or implied.
 *
 * Logos: TRACE never draws or approximates these marks. Each logo is the brand's
 * own official file, placed in public/brand/partners/<key>.svg (or .png) from the
 * source listed below and used unmodified (no recolouring, stretching, rotation
 * or effects). Until a file is present, a plain text wordmark is shown instead.
 * See docs/BRAND_ASSETS.md.
 */

export type Partner = {
  key: "uniswap" | "ethereum" | "1inch" | "0g" | "world";
  name: string;
  /** What TRACE uses it for — a role, not an integration status. */
  role: string;
  /** Where the official asset comes from. */
  source: string;
};

export const PARTNERS: Partner[] = [
  { key: "uniswap", name: "Uniswap", role: "V3 liquidity data", source: "https://uniswap.org (footer → Brand assets)" },
  { key: "ethereum", name: "Ethereum", role: "Sepolia testnet", source: "https://ethereum.org/en/assets/" },
  { key: "1inch", name: "1inch", role: "Aqua execution", source: "https://1inch.com (brandbook and assets)" },
  { key: "0g", name: "0G", role: "AI compute & storage", source: "https://0g.ai/brandkit" },
  { key: "world", name: "World", role: "World ID", source: "https://world.org/press" },
];

export const PARTNER_HEADING = "Built with ecosystem technologies";

/** Logo URLs that exist in /public, resolved on the server (layout.tsx). Missing → text wordmark. */
export type PartnerLogos = Partial<Record<Partner["key"], string>>;
