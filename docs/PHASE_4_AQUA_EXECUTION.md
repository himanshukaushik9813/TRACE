# TRACE — Phase 4: 1inch Aqua Execution Proof

**Status (2026-11-07):**
- **The compiler fix and hardening are implemented and unit-tested**: 93/93 tests, typecheck and lint clean.
- **Not yet proven:** a ship from the fixed compiler, either on real Sepolia (needs your wallet) or on a local fork (needs anvil on your Mac). Section 7 lists exactly what is outstanding.
- **Key finding:** the earlier compiler encoded every concentrated price range **1e18 too low**. All five strategies TRACE has shipped on Sepolia carry that error and should be docked.

Labels in this document:
- **real Sepolia**: read from or sent to the public Sepolia chain.
- **local fork**: an Anvil fork of Sepolia on the developer's machine.
- **test double**: the local JSON-RPC stub used by the unit tests.

---

## 1. What was inspected

| Item | Finding |
|---|---|
| Adapter | `packages/aqua-adapter`: `compat.ts` (rule-by-rule assessment), `compile.ts` (SDK compile), `chain.ts` (Sepolia reads and receipt verification) |
| SDKs | `@1inch/aqua-sdk` **0.4.0**, `@1inch/swap-vm-sdk` **0.5.0**. Both are newer than the 0.3.0 / 0.4.0 that the docs page names as carrying the current addresses. The SDK address tables have **no Sepolia entry**, so TRACE configures Sepolia addresses itself (`packages/chain-config`) |
| Execution flow | `src/components/guided-execute.tsx` (8 steps), `src/lib/aqua-flow.ts`, plus the API routes `/strategies/:id/compatibility`, `/strategies/:id/plan`, `/plans/:id/challenge`, `/authorizations`, `/transactions` and `/plans/:id/reconcile` |
| Existing tests | `test/aqua.test.mjs` (5 tests), `test/fork/aqua-fork.test.mjs` (1 test), and API authorization and duplicate tests |

## 2. Deployment on Sepolia

Sources: the official contract-address page ([business.1inch.com … /aqua/reference/contract-addresses](https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses)) and direct reads through `ethereum-sepolia-rpc.publicnode.com`, **real Sepolia**, at block **12,078,498** (2026-11-07).

| Contract | Address | Code on Sepolia | Notes |
|---|---|---|---|
| Current production registry | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` | yes, 5,619 bytes | The docs say it is also live on Sepolia |
| **Current production router** (AquaSwapVMRouter v1.0.2) | `0x111111338c5091e8440b67b168bae16a668ac0de` | **no (0 bytes)** | Not deployed on Sepolia |
| First vanity router (superseded on mainnet) | `0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de` | yes, 20,379 bytes | `AQUA()` returns the current registry |
| **2026-07-16 registry (used by TRACE)** | `0xe8026bf31e58b738647319362581ab11be92139b` | yes, 5,619 bytes | The docs keep the 07-16 generation available on Sepolia for testing |
| **2026-07-16 router (used by TRACE)** | `0x016b417bc933370f5eacc40b1d58b015ac72b070` | yes, 20,379 bytes | `AQUA()` = `0xe8026bf3…139b`; EIP-712 domain `1inch SwapVM v1.0` / `1.0.2` / chain 11155111 |
| KycNFT (taker gate) | `0x26FFc7D378E8e49Be2c483295A3e3E511F96a468` | yes, 8,303 bytes | Unchanged |

**Conclusion:**
- The current production router is not on Sepolia. TRACE therefore keeps the documented 2026-07-16 test pair, a router and registry that are wired to each other.
- The pairing is checked on every compatibility run (`aqua.router.registry`, which reads `router.AQUA()`).
- Whether the production router is present is reported as a non-blocking check (`info.production_router`).
- No address is invented. Sepolia is not part of 1inch's production chain set.

Permissions, according to the docs:
- The maker side (approve, `ship`, `dock`) is permissionless.
- Taker swaps require the KycNFT (`tx.origin` gate).
- TRACE's flow is maker-only.
- A router `quote` is a read-only call and works without the KycNFT. This was verified on real Sepolia.

## 3. The bug found, and its live impact

**The price encoding was wrong.**
- The SwapVM SDK defines concentrate bounds as `sqrt(P)·1e18`, where P = tokenGt/tokenLt in **token base units** (`Price.toSqrt()`, `ConcentrateGrowLiquidity2DArgs`).
- TRACE computed `sqrt(1.0001^tick)·1e9`, which is `sqrt(P)·1e9`. Every bound was therefore 1e9 too small, and every price 1e18 too low.
- Cross-check: for 3,000 USDC per WETH the SDK gives `18257418583505537115232`, while the old formula gives `18257418583506`.

**It was confirmed on real Sepolia.**
- A read-only router quote on the live USDC/WETH strategy (plan `cac98225`, strategy hash `0xf2410385…1de3`) priced 1e9 wei of WETH at 2.04e18 USDC base units.
- The reverse direction reverts with `TakerTraitsAmountOutMustBeGreaterThanZero(0)`.
- The router did price this exact order (the returned order hash equals the strategy hash), but at a nonsensical price.

**A second issue: one-token ships.**
- Four of the five ships registered only WETH (`tokensCount 1`).
- Aqua's `safeBalances` reverts for a token that was not registered at ship time, so those strategies cannot be traded in the other direction.

**The five TRACE ships on real Sepolia**, all from `0x6583…d2De`, registry `0xe802…139b`, all still active at block 12,078,498 according to `rawBalances`:

| Plan | Ship tx | Block | Shipped | Intended range (WETH per USDC) | Encoded on-chain |
|---|---|---|---|---|---|
| `7adbbae6` | `0x48350bf8…0ae37` | 12,074,438 | WETH 0.01 | 3.35e-5 – 3.80e-5 | ×1e-18 of that |
| `fedc9f06` | `0x4de0a62e…3818` | 12,074,615 | WETH 0.01 | 3.35e-5 – 3.80e-5 | ×1e-18 |
| `7e0fe9ee` | `0x789ce07d…1a4a` | 12,075,216 | WETH 0.0001 | 5.6e-6 – 4.85e-4 | ×1e-18 |
| `088fa193` | `0xddd99195…9000` | 12,075,231 | WETH 0.0001 | 5.6e-6 – 4.85e-4 | ×1e-18 |
| `cac98225` | `0xe79d5c41…c353` | 12,078,158 | USDC 0.001 + WETH 0.0001 | 5.6e-6 – 4.85e-4 | ×1e-18 (quote above) |

- **Exposure is bounded:** each approval was for exactly the shipped amount (testnet tokens), and taker fills require the KycNFT.
- **Recommended action (yours, from your wallet):** dock each one from Execute → Advanced → *Dock*, on the investigation that shipped it. Each dock has its own EIP-712 authorization. The exact-amount approvals stay in place until they are used or set to 0.
- TRACE never docks on its own.
- The earlier claim that "4 ships verified on-chain" remains true **as receipts**, meaning the transactions succeeded and matched their plans. What changes is that the strategies they created were mispriced.

## 4. What changed

### A. Compatibility (`compat.ts` `structuralChecks`, `chain.ts` `makerChecks`)
Every assessment now reports:

| Requirement | Check key | Source |
|---|---|---|
| Tokens | `tokens.distinct`, `token.<SYM>` (contract code) | chain |
| Token ordering | `tokens.order`: token0 < token1, so tokenLt/tokenGt; mis-ordered input is **Incompatible** | chain |
| Decimals | `tokens.decimals` (read from the token contracts, 0–36) | chain |
| Price boundaries | `price.bounds`: exact bounds, accepted by `ConcentrateGrowLiquidity2DArgs.fromSqrtPrices`; a full range maps to plain XYC | ir |
| Supported conditions | `info.conditions`: rules needing triggers, re-sets, exits or risk limits are listed as manual | ir |
| Supported operations | `info.operations`: approve, ship, dock (maker); swap is taker-only and KycNFT-gated | docs |
| Liquidity requirements | `liquidity.requirement`: which tokens the range needs at the pool's **real current price** (slot0) | chain |
| Capital requirements | `capital.requirement` + `maker.balance.*`, `maker.allowance.*` | chain |
| Router permissions | `aqua.router.registry` (`router.AQUA()` equals the registry), `taker.kyc` | chain |
| Deployment availability | `aqua.registry`, `aqua.router`, `info.production_router` | chain |

- Verdict labels: **"Fully compatible within supported scope" / "Partially compatible" / "Incompatible"** (`verdictLabel`).
- The rule-by-rule table is unchanged: entry and fee are supported; adjustment and exit are partial (dock and re-ship by hand); risk is unsupported.
- The note **"not a migration of the Uniswap NFT"** is always present.

### B. Deterministic compilation (`compile.ts`, `price.ts`)
- **Exact bounds:**
  - Uniswap `TickMath.getSqrtRatioAtTick`, ported to BigInt (checked against Uniswap's constants for tick 0, MIN_TICK and MAX_TICK);
  - then `sqrtPriceX96 · 1e18 / 2^96`;
  - no floating point reaches the order.
- **Spot-aware sizing:**
  - the pool's `slot0` is read on-chain;
  - the SDK's `computeLiquidityFromAmounts` sizes the shipped balances so the strategy starts at the pool price;
  - the amounts entered are maximums and are never exceeded.
  - Outside the range only one token backs the position, as on Uniswap.
  - The full range uses the spot ratio.
- **Both tokens are always registered** on ship, even when one ships 0. Only non-zero amounts get an (exact) approval.
- **Output validation** (`verifyCompiledPlan`): before a plan is returned, it is decoded back with the SDKs:
  - order round-trip and maker;
  - `keccak256(order)` equals the strategy hash;
  - ship calldata (target, app, exact order bytes, both tokens, amounts);
  - approvals exactly equal to the shipped amounts, spender = registry;
  - token order;
  - bounds against an independent float computation from the ticks (relative error < 1e-9) **and** against the SDK's `Price.fromSqrt().toHuman()`;
  - the start price implied by the shipped balances (SDK `computeLiquidityAndPrice`) is within 0.1% of the pool spot.
  - A failing check means **no plan**.
- **Provenance:** `plan.source = { strategyId, strategyVersionHash, compiler }`. The plan hash covers it, and the user's EIP-712 authorization pins the plan hash.
- **No model-generated bytecode:** a test rebuilds the program from the SDK builders and requires byte equality.

### C. Execution workflow (Execute page)

| Brief step | Where |
|---|---|
| 1–2 Connect wallet, verify network | Wallet connect; the steps block until the wallet is on Sepolia (`walletBlock`) |
| 3 Strategy plan | Steps 1–2 (strategy and compatibility verdict) |
| 4 Capital and token requirements | Step 4 (maximums, wallet balances, sizing to the pool price) and step 5 (the actual amounts, with the sizing explanation) |
| 5 Exact approval amount | Step 5 lists each approval with its exact amount and token contract |
| 6–7 Limited approval, confirm it | Step 7: approve per token, each receipt verified (`verifyTx`) |
| 8–9 Ship, confirm receipt | Step 7 ship; step 8 receipt (status, block, confirmations, matches plan, Shipped event, virtual balances) |
| 10 Verify state on-chain | **New:** step 8 "Checked on Sepolia" (`GET /plans/:id/state`): registry balances per token, plus a read-only router quote that must return this order's hash and a price inside the range |
| 11 Hashes and explorer links | Receipt and state panel (Etherscan links for txs, registry and router) |
| Docking | Advanced → Dock, behind its own EIP-712 authorization |

Safety properties:
- Nothing is sent without your click in your wallet, and a signed EIP-712 authorization bound to the plan hash.
- After a refresh, the page **reconciles** with Sepolia (`/plans/:id/reconcile`, reads only) and never re-sends.
- A second ship for the same plan is refused with 409 (both the sequential check and the unique DB index).

### D. Testnet versus fork
- The real Sepolia deployment (the 07-16 test pair) is used for live execution.
- The local fork test (`test/fork/aqua-fork.test.mjs`) runs the same compiled plans against the **real registry and router bytecode**: approve, ship, state (router quote inside the range, order hash match), dock, state docked.
- Fork results are never shown in the app as live.

## 5. Tests (`npm run test:unit`: **93 passed, 0 failed, 0 skipped**)

| Area | Test (file) |
|---|---|
| Compilation | Exact TickMath constants; bounds equal the SDK `Price` within half a tick; **regression: the old encoding was 1e9× too small**; deterministic plan, order and hash; bound to the strategy version; the SDK program rebuild equals the order (`aqua.test.mjs`) |
| Sizing | In range on the **real captured USDC/WETH spot**: amounts never exceed the request, the scarcer token is used in full, the implied start price equals the spot, and the bounds bracket the real price. Below or above the range: single token, both registered, one approval, a clear error for the wrong token. Full range: spot ratio |
| Compatibility | All the required checks are present; verdict labels; rule-by-rule partial/unsupported with gaps; Incompatible for inconclusive strategies, mis-ordered tokens, missing decimals or no position |
| Approval | Exact amounts equal the shipped amounts, spender = registry, never unlimited |
| Validator | Rejects the wrong price scale, a changed ship amount, an inflated approval, a wrong strategy hash, or another maker's order |
| On-chain verification (test double) | Active state with a matching quote inside the range; flags a wrong order hash, an out-of-range price, an unregistered token, docked and not-shipped |
| Failure | A reverted ship receipt is reported as `reverted` / "transaction reverted", never as shipped |
| Duplicate submission | Sequential second ship → 409 with the existing hash; concurrent ship hitting the DB index → 409 (`api.test.mjs`) |
| Read-only routes | `/plans/:id/state` and `/plans/:id/reconcile`: 404 for unknown ids, 400 for bad input |
| **Local fork** (`npm run test:fork`) | Real registry and router: concentrated plan around the live USDC/WETH price; ship; quote inside the range with the order hash matching; dock → docked. Fixture position: approve → ship → dock. **Not run here (no network in this environment); see section 7** |

## 6. Transaction references (real Sepolia)
The ships in section 3 and their approvals:

| Approval tx | Block |
|---|---|
| `0x04b632a8…6a5a` | 12,074,436 |
| `0x0983a2de…e753` | 12,074,613 |
| `0xe97a9f26…978f` | 12,075,214 |
| `0xa87f4bd1…6189` | 12,075,229 |
| `0xc7450de3…00d0` | 12,078,153 |
| `0x3ad0bc60…16cf1` | 12,078,156 |

All have status 1 in TRACE's verified transaction records. **No transaction from the fixed compiler exists yet.**

## 7. Outstanding (needs you), and blockers

1. **Push** this commit so Vercel and Render deploy the fixed compiler.
2. **Local fork proof:** run `npm run test:fork` on the Mac (needs `anvil` and `SEPOLIA_RPC_URL` in `.env.local`) and share the output. Until then, fork results are "not run".
3. **Real Sepolia proof:**
   - In the app, ship a small USDC/WETH strategy with the fixed compiler (approve and ship from your wallet).
   - TRACE then shows "Checked on Sepolia" with the router quote.
   - Its transaction hashes go into section 6.
4. **Dock the five mispriced strategies** from section 3, from your wallet.
5. **Not a blocker for this phase:** taker swaps need the KycNFT (issued to KYB-verified 1inch resolvers), so TRACE does not demonstrate a fill. A read-only quote is used as the strongest available proof that the router prices the strategy correctly.
