/**
 * @trace/chain-config — the single source of truth for TRACE's network and
 * contract configuration.
 *
 * TRACE runs on **Ethereum Sepolia (chainId 11155111) only**. There is no
 * mainnet entry in this package and `isSupportedChain` rejects every other
 * chain id, so no code path can silently reach mainnet.
 *
 * Every contract address below was verified on 2026-11-05/06 two ways:
 *   1. it appears in the protocol's official documentation (URL in `source`),
 *   2. `eth_getCode` on Sepolia returns non-empty bytecode.
 * The server re-runs the bytecode probe at startup (see server/src/integrations.ts)
 * and reports the live result on GET /integrations — the static `verifiedOn`
 * date is documentation, the runtime probe is the authority.
 *
 * Zero runtime dependencies: safe to import in the browser and in node.
 */
export declare const SEPOLIA_CHAIN_ID: 11155111;
export declare const SEPOLIA_CHAIN: {
    readonly chainId: 11155111;
    readonly name: "Ethereum Sepolia";
    readonly shortName: "Sepolia";
    readonly network: "testnet";
    readonly nativeCurrency: {
        readonly name: "Sepolia Ether";
        readonly symbol: "ETH";
        readonly decimals: 18;
    };
    /**
     * Keyless public RPC used ONLY by the browser for read calls (the wallet
     * provides its own RPC for writes). The server always uses SEPOLIA_RPC_URL
     * (an Infura/Alchemy key that never reaches the browser).
     */
    readonly publicRpc: "https://ethereum-sepolia-rpc.publicnode.com";
    readonly explorerUrl: "https://sepolia.etherscan.io";
    /** Average block time used only for "days back → block" window math. */
    readonly blockTimeSeconds: 12;
};
export type ContractRef = {
    address: `0x${string}`;
    /** Official documentation the address was taken from. */
    source: string;
};
export declare const UNISWAP_V3: {
    readonly factory: {
        readonly address: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
        readonly source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments";
    };
    readonly nonfungiblePositionManager: {
        readonly address: "0x1238536071E1c677A632429e3655c799b22cDA52";
        readonly source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments";
    };
    readonly quoterV2: {
        readonly address: "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
        readonly source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments";
    };
    readonly swapRouter02: {
        readonly address: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
        readonly source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments";
    };
};
/** Block the NonfungiblePositionManager was deployed at (Blockscout). Log scans never start earlier. */
export declare const NPM_DEPLOY_BLOCK = 3518286;
export declare const AQUA: {
    readonly registry: {
        readonly address: "0xe8026bf31e58b738647319362581ab11be92139b";
        readonly source: "https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses";
    };
    readonly swapVmRouter: {
        readonly address: "0x016b417bc933370f5eacc40b1d58b015ac72b070";
        readonly source: "https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses";
    };
    readonly kycNft: {
        readonly address: "0x26FFc7D378E8e49Be2c483295A3e3E511F96a468";
        readonly source: "https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses";
    };
};
/**
 * The CURRENT production pair (all 13 production chains), per the same docs page.
 * Checked on Sepolia, 2026-11-07, block 12,078,498: the registry has code there,
 * the router has none. Used only to report that fact; TRACE never ships to it on Sepolia.
 */
export declare const AQUA_PRODUCTION: {
    readonly registry: {
        readonly address: "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a";
        readonly source: "https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses";
    };
    readonly swapVmRouter: {
        readonly address: "0x111111338c5091e8440b67b168bae16a668ac0de";
        readonly source: "https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses";
    };
};
export declare const AQUA_NOTES: {
    readonly deployment: "Sepolia test deployment (2026-07-16 registry + AquaSwapVMRouter v1.0.2), documented by 1inch as available for testing; not the production chain set. The current production router (0x111111338c…c0de) is not deployed on Sepolia.";
    readonly takerGate: "Taker swaps require holding the 1inch KycNFT; without it the swap leg is blocked by the protocol.";
    readonly docsUrl: "https://business.1inch.com/portal/documentation/aqua/";
};
/** Every contract the server code-probes at startup. */
export declare const PROBED_CONTRACTS: {
    key: string;
    label: string;
    ref: ContractRef;
}[];
export declare const ZERO_G_GALILEO: {
    readonly chainId: 16602;
    readonly name: "0G Galileo Testnet";
    readonly rpc: "https://evmrpc-testnet.0g.ai";
    readonly indexerTurbo: "https://indexer-storage-testnet-turbo.0g.ai";
    readonly explorer: "https://chainscan-galileo.0g.ai";
    readonly storageExplorer: "https://storagescan-galileo.0g.ai";
    readonly faucet: "https://faucet.0g.ai";
};
/** Hard gate: only Sepolia. Everything else is refused, never redirected. */
export declare function isSupportedChain(chainId: number | null | undefined): chainId is typeof SEPOLIA_CHAIN_ID;
export declare function assertSupportedChain(chainId: number | null | undefined): asserts chainId is typeof SEPOLIA_CHAIN_ID;
export declare function isAddress(a: unknown): a is `0x${string}`;
export declare const CHAIN_LABEL = "Sepolia Testnet";
/** Explorer link builders — the only place any layer builds explorer URLs. */
export declare const explorer: {
    tx: (hash: string) => string;
    address: (addr: string) => string;
    token: (addr: string) => string;
    block: (n: number | bigint) => string;
    nft: (tokenId: number | string | bigint) => string;
};
export type IntegrationStatus = "VERIFIED LIVE" | "VERIFIED TESTNET" | "IMPLEMENTED BUT NOT VERIFIED" | "BLOCKED BY EXTERNAL DEPENDENCY" | "NOT IMPLEMENTED";
export type IntegrationReport = {
    key: string;
    label: string;
    status: IntegrationStatus;
    detail: string;
    /** ISO time the status was computed (runtime probe), not a build constant. */
    checkedAt: string;
};
