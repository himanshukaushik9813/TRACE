/**
 * Minimal ABI definitions for Uniswap V3 NonfungiblePositionManager, the events
 * TRACE reconstructs from. Kept as plain objects so the same file works with
 * viem (typed) and with any other decoder.
 */
export const NPM_ABI = [
    {
        type: "event",
        name: "PositionInitialized",
        anonymous: false,
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "sender", type: "address", indexed: true },
            { name: "mintedAmount", type: "uint128", indexed: false },
            { name: "tokensOwed0", type: "uint256", indexed: false },
            { name: "tokensOwed1", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "Mint",
        anonymous: false,
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "sender", type: "address", indexed: true },
            { name: "owner", type: "address", indexed: true },
            { name: "tickLower", type: "int24", indexed: false },
            { name: "tickUpper", type: "int24", indexed: false },
            { name: "amount", type: "uint128", indexed: false },
            { name: "amount0", type: "uint256", indexed: false },
            { name: "amount1", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "IncreaseLiquidity",
        anonymous: false,
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "sender", type: "address", indexed: true },
            { name: "liquidity", type: "uint128", indexed: false },
            { name: "amount0", type: "uint256", indexed: false },
            { name: "amount1", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "DecreaseLiquidity",
        anonymous: false,
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "sender", type: "address", indexed: true },
            { name: "liquidity", type: "uint128", indexed: false },
            { name: "amount0", type: "uint256", indexed: false },
            { name: "amount1", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "Collect",
        anonymous: false,
        inputs: [
            { name: "tokenId", type: "uint256", indexed: true },
            { name: "sender", type: "address", indexed: true },
            { name: "recipient", type: "address", indexed: false },
            { name: "amount0", type: "uint256", indexed: false },
            { name: "amount1", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "Transfer",
        anonymous: false,
        inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "tokenId", type: "uint256", indexed: true },
        ],
    },
    {
        type: "event",
        name: "TransferSingle",
        anonymous: false,
        inputs: [
            { name: "operator", type: "address", indexed: true },
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "id", type: "uint256", indexed: false },
            { name: "value", type: "uint256", indexed: false },
        ],
    },
];
/** Known Uniswap V3 NonfungiblePositionManager addresses. */
export const NPM_ADDRESSES = {
    1: "0xC36442b694309679559c5940b50eBC05f4c10a80",
    10: "0x03a5b0Cc65d1319D0811b8c75f5b397638b5Df25",
    8453: "0x03a5b0Cc65d1319D0811b8c75f5b397638b5Df25",
    42161: "0x26513eA94163bCb7651f38089e65D114CFc15903",
};
/** Fixed decimals for the common tokens TRACE handles; expand via a chain oracle in production. */
export const TOKEN_DECIMALS = {
    WETH: 18,
    "0xc02aaa39b223fe8d0a0e5c4f27fd97d2f33d4e7d0": 18,
    USDC: 6,
    "0xa0b86991cf2f682a8d058a20982c3b5cbf92320f": 6,
    USDT: 6,
    DAI: 18,
    WBTC: 8,
};
