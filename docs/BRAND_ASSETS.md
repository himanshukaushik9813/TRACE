# Ecosystem logos in the launch intro

The launch intro shows the technologies TRACE is built with under the heading
**"BUILT WITH ECOSYSTEM TECHNOLOGIES"**. This does not claim any partnership,
sponsorship, grant or endorsement, and the intro must never say otherwise.

TRACE never draws or approximates these marks. Each logo is the brand's own file,
used unmodified. Until a file is present, the intro shows a plain text wordmark
(the name in TRACE's UI font).

## Where to put the files

`public/brand/partners/<key>.svg` (or `.png` / `.webp`). The layout picks them up
automatically on the next build or dev reload.

| Key | Brand | Official source | Which file |
|---|---|---|---|
| `uniswap` | Uniswap | uniswap.org → footer → **Brand assets** (follow the Uniswap Trademark Policy) | Lockup (unicorn + wordmark), the version for light backgrounds |
| `ethereum` | Ethereum | https://ethereum.org/en/assets/ → "Ethereum brand assets", transparent background | **ETH logo landscape (gray)** or (purple) |
| `1inch` | 1inch | https://1inch.com → brandbook and assets (per help.1inch.com, Rebranding FAQ) | Horizontal logo for light backgrounds |
| `0g` | 0G | https://0g.ai/brandkit | Primary logo for light backgrounds |
| `world` | World | https://world.org/press (media kit) | World logo (wordmark) for light backgrounds |

## How they are displayed (brand rules respected)

- **Size:** fixed height (20 px on mobile, 22 px on desktop) and natural width (`object-fit: contain`). Never stretched or cropped.
- **No changes to the mark:** no recolouring, rotation, filters or shadows on the logo itself. 0G's brand kit forbids drop shadows, rotation and stretching. The subtle depth and hover effects move the white card, never the mark.
- **Hierarchy:** logos are smaller than TRACE and sit on white cards, below the TRACE identity.
- **Captions:** each card's caption states what TRACE uses the technology for ("V3 liquidity data", "Sepolia testnet", "Aqua execution", "AI compute & storage", "World ID"). That is a role, not an integration status.
