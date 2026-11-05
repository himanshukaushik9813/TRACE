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
export declare const NPM_ABI: readonly [{
    readonly name: "IncreaseLiquidity";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "tokenId";
        readonly indexed: true;
    }, {
        readonly type: "uint128";
        readonly name: "liquidity";
    }, {
        readonly type: "uint256";
        readonly name: "amount0";
    }, {
        readonly type: "uint256";
        readonly name: "amount1";
    }];
}, {
    readonly name: "DecreaseLiquidity";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "tokenId";
        readonly indexed: true;
    }, {
        readonly type: "uint128";
        readonly name: "liquidity";
    }, {
        readonly type: "uint256";
        readonly name: "amount0";
    }, {
        readonly type: "uint256";
        readonly name: "amount1";
    }];
}, {
    readonly name: "Collect";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "tokenId";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "recipient";
    }, {
        readonly type: "uint256";
        readonly name: "amount0";
    }, {
        readonly type: "uint256";
        readonly name: "amount1";
    }];
}, {
    readonly name: "Transfer";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "from";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "to";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "tokenId";
        readonly indexed: true;
    }];
}, {
    readonly name: "positions";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "tokenId";
    }];
    readonly outputs: readonly [{
        readonly type: "uint96";
        readonly name: "nonce";
    }, {
        readonly type: "address";
        readonly name: "operator";
    }, {
        readonly type: "address";
        readonly name: "token0";
    }, {
        readonly type: "address";
        readonly name: "token1";
    }, {
        readonly type: "uint24";
        readonly name: "fee";
    }, {
        readonly type: "int24";
        readonly name: "tickLower";
    }, {
        readonly type: "int24";
        readonly name: "tickUpper";
    }, {
        readonly type: "uint128";
        readonly name: "liquidity";
    }, {
        readonly type: "uint256";
        readonly name: "feeGrowthInside0LastX128";
    }, {
        readonly type: "uint256";
        readonly name: "feeGrowthInside1LastX128";
    }, {
        readonly type: "uint128";
        readonly name: "tokensOwed0";
    }, {
        readonly type: "uint128";
        readonly name: "tokensOwed1";
    }];
}, {
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "tokenOfOwnerByIndex";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }, {
        readonly type: "uint256";
        readonly name: "index";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "ownerOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "tokenId";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}];
export declare const FACTORY_ABI: readonly [{
    readonly name: "getPool";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "tokenA";
    }, {
        readonly type: "address";
        readonly name: "tokenB";
    }, {
        readonly type: "uint24";
        readonly name: "fee";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
        readonly name: "pool";
    }];
}];
export declare const POOL_ABI: readonly [{
    readonly name: "token0";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "token1";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "fee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint24";
    }];
}, {
    readonly name: "tickSpacing";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "int24";
    }];
}, {
    readonly name: "liquidity";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint128";
    }];
}, {
    readonly name: "slot0";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint160";
        readonly name: "sqrtPriceX96";
    }, {
        readonly type: "int24";
        readonly name: "tick";
    }, {
        readonly type: "uint16";
        readonly name: "observationIndex";
    }, {
        readonly type: "uint16";
        readonly name: "observationCardinality";
    }, {
        readonly type: "uint16";
        readonly name: "observationCardinalityNext";
    }, {
        readonly type: "uint8";
        readonly name: "feeProtocol";
    }, {
        readonly type: "bool";
        readonly name: "unlocked";
    }];
}, {
    readonly name: "Swap";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sender";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "recipient";
        readonly indexed: true;
    }, {
        readonly type: "int256";
        readonly name: "amount0";
    }, {
        readonly type: "int256";
        readonly name: "amount1";
    }, {
        readonly type: "uint160";
        readonly name: "sqrtPriceX96";
    }, {
        readonly type: "uint128";
        readonly name: "liquidity";
    }, {
        readonly type: "int24";
        readonly name: "tick";
    }];
}];
export declare const ERC20_ABI: readonly [{
    readonly name: "symbol";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "string";
    }];
}, {
    readonly name: "decimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "allowance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }, {
        readonly type: "address";
        readonly name: "spender";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}];
export declare const ZERO_ADDRESS: "0x0000000000000000000000000000000000000000";
