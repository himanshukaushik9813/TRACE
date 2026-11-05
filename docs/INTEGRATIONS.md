# Integrations

Every integration is either working against real infrastructure or labelled with why it is not. The server computes these labels live (`GET /integrations`, shown on the Reports screen). The table below is the status as of **2026-11-06**.

| Integration | Status | Evidence |
|---|---|---|
| Ethereum Sepolia RPC | **VERIFIED TESTNET** | `eth_chainId` = `0xaa36a7`; live block reads |
| Uniswap V3 on Sepolia (data) | **VERIFIED TESTNET** | Official addresses, bytecode probed; real wallets reconstructed (`npm run test:live`) |
| 1inch Aqua / SwapVM (Sepolia test deployment) | **IMPLEMENTED BUT NOT VERIFIED** on Sepolia; ship/dock **verified on a Sepolia fork** | `approve` and `ship` simulate OK on Sepolia; the full approve → ship → dock cycle passes against the real contracts on an Anvil fork (`npm run test:fork`). Becomes VERIFIED TESTNET after the first real ship receipt from a user wallet. |
| Aqua swap (taker side) | **BLOCKED BY EXTERNAL DEPENDENCY** | The protocol requires the 1inch **KycNFT**, which the test wallets do not hold |
| 0G Private Computer (Router) inference | **BLOCKED BY EXTERNAL DEPENDENCY** | Calls go out for real and return real router request IDs. The configured key is locked to *private* (TEE) trust mode, and no model currently has a private provider, so every call fails with `no_provider_for_trust_mode`. |
| 0G Storage (Galileo testnet) | **BLOCKED BY EXTERNAL DEPENDENCY** | Real SDK uploads are attempted; the dedicated uploader wallet has 0 balance, so they fail with `INSUFFICIENT_FUNDS` |
| EIP-712 wallet authorization | **IMPLEMENTED BUT NOT VERIFIED** with a real MetaMask signature | Verified in tests with real secp256k1 signatures (tamper, replay, expiry, wrong signer, wrong chain) |
| World ID v4 (staging) | **BLOCKED BY EXTERNAL DEPENDENCY** | Built; no `WORLD_RP_ID` / `WORLD_RP_SIGNING_KEY` configured |
| Postgres (Supabase) | **VERIFIED LIVE** | Migrations applied via the IPv4 session pooler |
| Job queue (BullMQ on Upstash Redis, TLS) | **VERIFIED LIVE** | `PING` → `PONG`; jobs processed |

---

## Ethereum Sepolia + Uniswap V3

- **Chain:** Sepolia (11155111) only. Chain config lives in one place, `packages/chain-config`. The server refuses any other chain id or a mainnet-looking RPC URL. The wallet config contains only Sepolia.
- **Contracts:** the official Uniswap V3 deployments from [developers.uniswap.org](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments) and `sdk-core`, re-probed with `eth_getCode` at every server start:
  - Factory: `0x0227628f3F023bb0B980b67D528571c95c6DaC1c`
  - NonfungiblePositionManager: `0x1238536071E1c677A632429e3655c799b22cDA52` (deploy block 3,518,286)
  - QuoterV2: `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3`
  - SwapRouter02: `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`
- **Discovery.** In NPM lifecycle events only `tokenId` is indexed, so TRACE finds a wallet's positions in two ways:
  - ERC-721 `Transfer` logs, from and to the wallet.
  - `balanceOf` + `tokenOfOwnerByIndex` for the positions it currently holds.

  It then pulls `IncreaseLiquidity`, `DecreaseLiquidity` and `Collect` logs filtered by token ID. `positions(tokenId)`, `factory.getPool` and ERC-20 metadata are batched through Multicall3. Burned positions are read at `burnBlock − 1`.
- **Accounting.** A V3 `Collect` returns principal owed from earlier decreases *plus* fees. TRACE splits each collect into those two parts, so fees are never double-counted as principal.
- **Prices.** Price history comes from the pool's real `Swap` events (sqrtPriceX96, tick, amounts, active liquidity). Timestamps between up to 24 sampled anchor blocks are interpolated, and the UI says so.

## 1inch Aqua / SwapVM

- **What is real.**
  - TRACE builds a **SwapVM order** with the official `@1inch/swap-vm-sdk`: `AquaXYCAmmStrategy.newConcentrate({ sqrtPriceMin, sqrtPriceMax })` built from the real position ticks, `withFeeTokenIn` set from the fee tier, and a deterministic salt.
  - It encodes `ship` and `dock` with `@1inch/aqua-sdk`, plus **exact-amount** ERC-20 approvals.
  - The user signs each transaction in MetaMask. The server verifies the receipt, the `Shipped` / `Docked` event and the registry's `rawBalances`.
- **Deployment.** The [1inch docs](https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses) list Sepolia as *not* part of the production chain set. The current router is not deployed there. The documented 2026-07-16 pair is still live for testing, and TRACE uses it:
  - Registry: `0xe8026bf31e58b738647319362581ab11be92139b`
  - AquaSwapVMRouter: `0x016b417bc933370f5eacc40b1d58b015ac72b070`
  - KycNFT: `0x26FFc7D378E8e49Be2c483295A3e3E511F96a468`
- **Different instruments.** A Uniswap V3 NFT is not an Aqua strategy. TRACE ships a *compatible implementation of the supported rules* and never claims to migrate the NFT.
- **Not compiled, and shown as such:** price triggers, schedules and stop-losses. Aqua strategies are immutable once shipped, so re-ranging means a manual dock followed by a new ship.

## 0G Private Computer (inference)

- **Call.** TRACE calls the OpenAI-compatible **0G Router** (`POST {ZERO_G_ROUTER_URL}/chat/completions`) with `verify_tee: true` and a structured evidence pack.
  - It records `x_0g_trace.request_id`, the provider, `tee_verified`, usage and a hash of the response in `inference_runs`.
- **Gate.** The model's JSON is checked by a deterministic gate before it is ever used:
  - schema validation;
  - every rule must cite transaction hashes from the evidence set, and rules that cite anything else are dropped;
  - confidences are capped at the level the deterministic layer supports;
  - `inconclusive` is returned when the evidence is thin.
- **On failure** the UI shows the real error and request ID, plus the separately labelled *evidence-only* analysis. A fabricated AI answer is never shown.
- **Current blocker.** The provided key comes from the mainnet router dashboard ([pc.0g.ai](https://pc.0g.ai)) and is fixed to *private* trust mode.
  - The router currently has no private provider for any model (`no_provider_for_trust_mode`).
  - Requesting another trust mode returns `trust_mode_mismatch`.
- **To unblock**, do one of these:
  - Create a key with *standard* or *verified* trust mode.
  - Wait for private providers to appear. No code change is needed.

## 0G Storage (Galileo testnet)

- **Upload.** `@0gfoundation/0g-storage-ts-sdk`: the canonical JSON goes into `MemData`, gets a Merkle tree, and is uploaded with `indexer.upload` to `{rootHash, txHash}`.
- **Verification.** The artifact is then downloaded back with Merkle-proof verification (`downloadToBlob(rootHash, { proof: true })`) and compared byte for byte.
- **What is shown.** A reference appears only after a successful upload; the "retrievable" badge appears only after a verified read-back.
- **Artifacts:** investigation summary, Strategy DNA, inference run, Strategy IR version.
- **Current blocker.** The uploader (`OG_STORAGE_ADDRESS`, a dedicated burner) needs testnet 0G for gas and storage fees.
  - Fund it at [faucet.0g.ai](https://faucet.0g.ai), then press **Retry archive** on the Reports screen.

## Authorization

- **EIP-712 (always required).**
  - The connected wallet signs `Authorization{wallet, chainId, strategyId, strategyVersionHash, planHash, action, challenge, expiresAt}`.
  - The server recovers the signer and checks every binding against the database.
  - The single-use challenge is consumed atomically, so a replay is rejected.
  - Execution endpoints refuse any transaction that isn't covered by a validated authorization.
  - A frontend button on its own is never treated as authorization.
- **World ID v4 (optional layer).**
  - The IDKit `signal` is the keccak256 of the same claims.
  - The backend signs the RP request, forwards the proof to `developer.world.org/api/v4/verify/{rp_id}`, matches the `signal_hash` and enforces `(nullifier, action)` uniqueness.
  - It is labelled *World ID staging — not production identity verification*.
  - "World Agent Pass" is not an official World product; the real agent offering is AgentKit, which needs World App verification.
