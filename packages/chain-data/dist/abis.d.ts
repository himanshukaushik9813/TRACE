/**
 * Minimal ABI definitions for Uniswap V3 NonfungiblePositionManager, the events
 * TRACE reconstructs from. Kept as plain objects so the same file works with
 * viem (typed) and with any other decoder.
 */
export declare const NPM_ABI: readonly [{
    readonly type: "event";
    readonly name: "PositionInitialized";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "sender";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "mintedAmount";
        readonly type: "uint128";
        readonly indexed: false;
    }, {
        readonly name: "tokensOwed0";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "tokensOwed1";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "Mint";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "sender";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "owner";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tickLower";
        readonly type: "int24";
        readonly indexed: false;
    }, {
        readonly name: "tickUpper";
        readonly type: "int24";
        readonly indexed: false;
    }, {
        readonly name: "amount";
        readonly type: "uint128";
        readonly indexed: false;
    }, {
        readonly name: "amount0";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "amount1";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "IncreaseLiquidity";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "sender";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "liquidity";
        readonly type: "uint128";
        readonly indexed: false;
    }, {
        readonly name: "amount0";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "amount1";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "DecreaseLiquidity";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "sender";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "liquidity";
        readonly type: "uint128";
        readonly indexed: false;
    }, {
        readonly name: "amount0";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "amount1";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "Collect";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "sender";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "recipient";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "amount0";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "amount1";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "Transfer";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "to";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }];
}, {
    readonly type: "event";
    readonly name: "TransferSingle";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "operator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "from";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "to";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "id";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}];
/** Known Uniswap V3 NonfungiblePositionManager addresses. */
export declare const NPM_ADDRESSES: Record<number, string>;
/** Fixed decimals for the common tokens TRACE handles; expand via a chain oracle in production. */
export declare const TOKEN_DECIMALS: Record<string, number>;
