/**
 * ABIs for the exact on-chain contracts TRACE reads, transcribed from the
 * official sources:
 *   - Uniswap/v3-periphery INonfungiblePositionManager.sol (+ OZ ERC721)
 *   - Uniswap/v3-core IUniswapV3Factory / IUniswapV3Pool{Immutables,State,Events}
 *   - ERC-20 metadata
 *
 * In every NPM lifecycle event ONLY `tokenId` is indexed — the wallet can only
 * be found through the ERC-721 `Transfer` event (from/to/tokenId all indexed).
 */
import { parseAbi } from "viem";
export const NPM_ABI = parseAbi([
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
    "event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
    "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
    "function balanceOf(address owner) view returns (uint256)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
]);
export const FACTORY_ABI = parseAbi([
    "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);
export const POOL_ABI = parseAbi([
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function fee() view returns (uint24)",
    "function tickSpacing() view returns (int24)",
    "function liquidity() view returns (uint128)",
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
export const ERC20_ABI = parseAbi([
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
]);
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
