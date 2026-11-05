/**
 * TRACE brand artwork registry.
 *
 * These are the generated fine-line / engraved illustrations, mapped to the
 * semantic role the design system assigns each one. Decorative artwork only —
 * live financial data is always rendered as real HTML/SVG charts (see
 * components/charts), never as a generated image.
 */
export const art = {
  // Signature illustrations
  topoWaves: "/images/tiles/hero-topo-waves.png", // abstract topographic waves — main hero background
  mountain: "/images/tiles/mountain-engraving.png", // fine-line mountain — sidebar footer
  ethEmblem: "/images/tiles/eth-emblem.png", // geometric Ethereum emblem — chain identity
  identicon: "/images/tiles/identicon.png", // wallet identicon pattern
  fingerprint: "/images/tiles/strategy-fingerprint.png", // fingerprint/topo Strategy DNA
  aiNetwork: "/images/tiles/ai-network.png", // abstract AI network geometry
  liquidityRange: "/images/tiles/liquidity-range.png", // liquidity-range diagram
  candlestick: "/images/tiles/candlestick.png", // candlestick supporting artwork
  lifecycle: "/images/tiles/lifecycle-icons.png", // position event lifecycle icons
  metallicTokens: "/images/tiles/metallic-tokens.png", // token pair identification
  equityCurve: "/images/tiles/equity-curve.png", // backtest empty state / explanatory visual
  confirmation: "/images/tiles/confirmation-emblem.png", // execution success confirmation

  // High-resolution variants (for larger hero / feature placements)
  lg: {
    mountain: "/images/tiles/mountain-lg.png",
    fingerprint: "/images/tiles/fingerprint-lg.png",
    tokens: "/images/tiles/tokens-lg.png",
    equity: "/images/tiles/equity-lg.png",
    confirmation: "/images/tiles/confirmation-lg.png",
  },

  // Full sprite sheets — reference / design-system pages only
  motifs: {
    mountainMarket: "/images/motifs/mountain-and-market-motifs.png",
    strategyGrid: "/images/motifs/strategy-icon-grid.png",
    trace: "/images/motifs/trace-intelligence.png",
    trace2: "/images/motifs/trace-intelligence-2.png",
  },
} as const;

/**
 * Central place for the "demo mode" flag so every screen can label clearly
 * that its figures come from the labelled known-good fixture, not a live
 * chain. Toggled per the spec: "clearly identify demo mode."
 */
export const DEMO_MODE = true;
