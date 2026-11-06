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
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN = {
    chainId: SEPOLIA_CHAIN_ID,
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    network: "testnet",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    /**
     * Keyless public RPC used ONLY by the browser for read calls (the wallet
     * provides its own RPC for writes). The server always uses SEPOLIA_RPC_URL
     * (an Infura/Alchemy key that never reaches the browser).
     */
    publicRpc: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    /** Average block time used only for "days back → block" window math. */
    blockTimeSeconds: 12,
};
/* ------------------------------------------------------------------ */
/*  Uniswap V3 — official Sepolia deployment                           */
/*  https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments
 *  and Uniswap/sdks sdk-core SEPOLIA_ADDRESSES                         */
/* ------------------------------------------------------------------ */
const UNI_DOCS = "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments";
export const UNISWAP_V3 = {
    factory: { address: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c", source: UNI_DOCS },
    nonfungiblePositionManager: { address: "0x1238536071E1c677A632429e3655c799b22cDA52", source: UNI_DOCS },
    quoterV2: { address: "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3", source: UNI_DOCS },
    swapRouter02: { address: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E", source: UNI_DOCS },
};
/** Block the NonfungiblePositionManager was deployed at (Blockscout). Log scans never start earlier. */
export const NPM_DEPLOY_BLOCK = 3_518_286;
/* ------------------------------------------------------------------ */
/*  1inch Aqua / SwapVM — documented Sepolia test deployment            */
/*  https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses
 *
 *  The docs state Sepolia is NOT part of the production Aqua chain set and
 *  that the current router is not yet on Sepolia; the 2026-07-16 registry +
 *  AquaSwapVMRouter pair remains available for testing. Those are what we
 *  use. Taker swaps are gated by the KycNFT.                          */
/* ------------------------------------------------------------------ */
const AQUA_DOCS = "https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses";
export const AQUA = {
    registry: { address: "0xe8026bf31e58b738647319362581ab11be92139b", source: AQUA_DOCS },
    swapVmRouter: { address: "0x016b417bc933370f5eacc40b1d58b015ac72b070", source: AQUA_DOCS },
    kycNft: { address: "0x26FFc7D378E8e49Be2c483295A3e3E511F96a468", source: AQUA_DOCS },
};
/**
 * The CURRENT production pair (all 13 production chains), per the same docs page.
 * Checked on Sepolia, 2026-11-07, block 12,078,498: the registry has code there,
 * the router has none. Used only to report that fact; TRACE never ships to it on Sepolia.
 */
export const AQUA_PRODUCTION = {
    registry: { address: "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a", source: AQUA_DOCS },
    swapVmRouter: { address: "0x111111338c5091e8440b67b168bae16a668ac0de", source: AQUA_DOCS },
};
export const AQUA_NOTES = {
    deployment: "Sepolia test deployment (2026-07-16 registry + AquaSwapVMRouter v1.0.2), documented by 1inch as available for testing; not the production chain set. The current production router (0x111111338c…c0de) is not deployed on Sepolia.",
    takerGate: "Taker swaps require holding the 1inch KycNFT; without it the swap leg is blocked by the protocol.",
    docsUrl: "https://business.1inch.com/portal/documentation/aqua/",
};
/** Every contract the server code-probes at startup. */
export const PROBED_CONTRACTS = [
    { key: "uniswap.factory", label: "Uniswap V3 Factory", ref: UNISWAP_V3.factory },
    { key: "uniswap.npm", label: "Uniswap V3 NonfungiblePositionManager", ref: UNISWAP_V3.nonfungiblePositionManager },
    { key: "uniswap.quoterV2", label: "Uniswap V3 QuoterV2", ref: UNISWAP_V3.quoterV2 },
    { key: "uniswap.swapRouter02", label: "Uniswap SwapRouter02", ref: UNISWAP_V3.swapRouter02 },
    { key: "aqua.registry", label: "1inch Aqua registry", ref: AQUA.registry },
    { key: "aqua.swapVmRouter", label: "1inch AquaSwapVMRouter", ref: AQUA.swapVmRouter },
    { key: "aqua.kycNft", label: "1inch KycNFT", ref: AQUA.kycNft },
];
/* ------------------------------------------------------------------ */
/*  0G (Galileo testnet) — storage                                      */
/* ------------------------------------------------------------------ */
export const ZERO_G_GALILEO = {
    chainId: 16602,
    name: "0G Galileo Testnet",
    rpc: "https://evmrpc-testnet.0g.ai",
    indexerTurbo: "https://indexer-storage-testnet-turbo.0g.ai",
    explorer: "https://chainscan-galileo.0g.ai",
    storageExplorer: "https://storagescan-galileo.0g.ai",
    faucet: "https://faucet.0g.ai",
};
/* ------------------------------------------------------------------ */
/*  Guards + helpers                                                   */
/* ------------------------------------------------------------------ */
/** Hard gate: only Sepolia. Everything else is refused, never redirected. */
export function isSupportedChain(chainId) {
    return chainId === SEPOLIA_CHAIN_ID;
}
export function assertSupportedChain(chainId) {
    if (!isSupportedChain(chainId)) {
        throw new Error(`unsupported chain ${chainId}: TRACE only runs on Ethereum Sepolia (${SEPOLIA_CHAIN_ID})`);
    }
}
export function isAddress(a) {
    return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}
export const CHAIN_LABEL = "Sepolia Testnet";
/** Explorer link builders — the only place any layer builds explorer URLs. */
export const explorer = {
    tx: (hash) => `${SEPOLIA_CHAIN.explorerUrl}/tx/${hash}`,
    address: (addr) => `${SEPOLIA_CHAIN.explorerUrl}/address/${addr}`,
    token: (addr) => `${SEPOLIA_CHAIN.explorerUrl}/token/${addr}`,
    block: (n) => `${SEPOLIA_CHAIN.explorerUrl}/block/${n}`,
    nft: (tokenId) => `${SEPOLIA_CHAIN.explorerUrl}/nft/${UNISWAP_V3.nonfungiblePositionManager.address}/${tokenId}`,
};
