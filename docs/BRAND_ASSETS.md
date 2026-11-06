# Ecosystem logos in the launch intro

The launch intro shows the technologies TRACE is built with under the heading
**"BUILT WITH ECOSYSTEM TECHNOLOGIES"**. This does not claim any partnership,
sponsorship, grant or endorsement, and the intro must never say otherwise.

TRACE never draws or approximates these marks. Each logo is the brand's own file,
used unmodified. Until a file is present, the intro shows a plain text wordmark
(the name in TRACE's UI font).

## Sources: official files, loaded from each brand's own host

Configured in `src/lib/partners.ts`. All five were checked on 2026-11-07, and each loads cross-origin from trace-eth.vercel.app.

| Brand | Official file | Found on |
|---|---|---|
| Uniswap | `raw.githubusercontent.com/Uniswap/brand-assets/main/Uniswap Brand Assets/Uniswap_horizontallogo_pink.svg` | github.com/Uniswap/brand-assets (linked as "Brand assets" from uniswap.org). The README asks users to follow the Brand Guide and Trademark Policy |
| Ethereum | `ethereum.org/images/assets/svgs/ethereum-logo-landscape-black.svg` | ethereum.org/en/assets: "ETH logo landscape", transparent background |
| 1inch | `1inch.com/assets/images/landing/press-room/assets/1inch_logo_black.svg` | 1inch.com/press-room: "1inch wordmark black logo", the version for light backgrounds |
| 0G | `0g.ai/assets/681c472ba991e2e4ca164fe6_Black-OG-Logo.svg` | 0g.ai/brandkit: black ØG logo |

**Self-hosting** (optional): put the same file in `public/brand/partners/<key>.svg`. The layout then serves it from TRACE's domain instead of the brand's host.

If a logo fails to load, the card falls back to a plain text wordmark.

## How they are displayed (brand rules respected)

- **Size:** fixed height (20 px on mobile, 22 px on desktop) and natural width (`object-fit: contain`). Never stretched or cropped.
- **No changes to the mark:** no recolouring, rotation, filters or shadows on the logo itself. 0G's brand kit forbids drop shadows, rotation and stretching. The subtle depth and hover effects move the white card, never the mark.
- **Hierarchy:** logos are smaller than TRACE and sit on white cards, below the TRACE identity.
- **Captions:** each card's caption states what TRACE uses the technology for ("V3 liquidity data", "Sepolia testnet", "Aqua execution", "AI compute & storage"). That is a role, not an integration status.
