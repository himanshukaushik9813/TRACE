# TRACE — Phase 5: World ID Human Authorization

**Status (2026-11-07):**
- The full authorization workflow is **implemented and unit-tested**: 110/110 tests, typecheck and lint clean.
- **It has not been verified live.** No World ID app is registered for TRACE (`WORLD_APP_ID`, `WORLD_RP_ID` and `WORLD_RP_SIGNING_KEY` are unset on Render), so no real or simulator proof has ever been verified.
- Following the brief, **protected execution (shipping a strategy to Aqua) is disabled** until those credentials exist.
- No successful verification is claimed anywhere in the app or in this document.

## 1. Which World ID product

| Brief term | Finding (official docs, checked 2026-11-07) |
|---|---|
| "World ID Agent Pass" | No product with this name exists in docs.world.org or World's announcements |
| AgentKit (World's agent product) | An **agent's wallet** is registered in AgentBook with a one-time World ID proof, then it signs CAIP-122/x402 challenges to reach APIs ([docs](https://docs.world.org/agents/agent-kit/integrate)). It authorizes an agent's access, not a human approving one specific transaction, so it does not fit this flow |
| **World ID 4.0 via IDKit** (used) | A per-request proof of human. The backend signs the RP request, the browser runs IDKit with a `signal`, and the backend forwards the proof unchanged to `POST https://developer.world.org/api/v4/verify/{rp_id}`, checks the environment and stores the nullifier ([integrate guide](https://docs.world.org/world-id/idkit/integrate)). This is the documented way to bind a fresh human proof to one action |

SDKs: `@worldcoin/idkit` 4.6.0 (React `IDKitRequestWidget`, `orbLegacy({ signal })` preset) and `@worldcoin/idkit-core` 4.6.0 (`signRequest`, `hashSignal`).

## 2. What is protected, and how

- **Protected action:** `aqua:ship`, which approves exact token amounts and ships the strategy to 1inch Aqua (`PROTECTED_ACTIONS` in `packages/world-auth/src/proof.ts`).
- **Not protected:** `aqua:dock`. Removing a strategy must never be blocked, so dock needs only the wallet signature.

| Brief step | Implementation |
|---|---|
| 1. Review the strategy | Execute steps 1–3 (strategy, Aqua compatibility, what runs) |
| 2. Specific execution plan | Steps 4–5: a deterministic plan with `planHash`, compiled from one strategy version (Phase 4) |
| 3. Unique challenge | `POST /plans/:id/challenge`: 32 random bytes, stored single-use with a 10-minute expiry |
| 4. Binding | The claims are wallet (identity reference for the signer), chain, strategy id, **strategy version hash**, **plan hash**, **action**, **challenge** and **expiry**. The World ID `signal` is keccak256 of exactly these claims. The RP request (nonce and expiry, signed by the server with `signRequest`) is sealed to the challenge with a server-keyed token. The verified human's **nullifier** (anonymous, action-scoped) is stored as the identity reference |
| 5. Official World ID flow | `src/components/world-id.tsx`: `IDKitRequestWidget` with the server-issued `app_id`, `action`, `rp_context`, `environment` and `orbLegacy({ signal })`. Nothing is signed in the browser |
| 6. Backend validates independently | `verifyWorldProof`, in order: request seal → request expiry → nonce → action → environment → no session proofs → every `signal_hash` equals `hashSignal(signal)` → World's verify API (proof forwarded unchanged) → `success === true` → response environment → nullifier present → nullifier and nonce recorded once |
| 7. Only valid authorization proceeds | `POST /authorizations` validates only if the wallet checks **and** the World ID verdict both pass. Then `POST /transactions` checks again: an `aqua:ship` authorization without `worldStatus = verified` is refused (403) |

**Identity verification versus wallet signing.** These are two separate steps in the UI and the API:
- **World ID** proves a unique human approved this exact plan. It is not a transaction and stores only an anonymous nullifier.
- **The EIP-712 wallet signature** proves control of the wallet. It is not identity.
- Neither is ever inferred from the other (`verification.worldId` and `verification.signatureOk` are separate fields).

**What this protects, and what it cannot.**
- World ID gates **TRACE's** execution flow: TRACE will not authorize, track or verify a protected ship without a verified human.
- It cannot stop a wallet owner from sending a transaction to Aqua outside TRACE, because Aqua's ship is permissionless and the user holds their own keys.
- An on-chain gate would need a World ID check inside the contract. That is out of scope here and not claimed.

**Rejections:**

| Case | Where | Result |
|---|---|---|
| Invalid proof | World verify API answers non-2xx or `success ≠ true` | `rejected` |
| Expired proof | Request past its `expires_at` (and the claims' 10-minute expiry) | `expired`; IDKit `rp_signature_expired` / `timestamp_too_old` → Expired in the UI |
| Replayed proof | Challenge already consumed, or (nullifier, action#nonce) already recorded | `replayed` |
| Cancelled | No proof submitted (IDKit `user_rejected`, widget closed) | `required` → not authorized |
| Changed strategy version | Claims ≠ stored version (signature check), and the signal no longer matches the proof | Rejected |
| Changed plan hash | Same, for the plan hash | Rejected |
| Wrong action | Proof `action` ≠ configured action, or claims action ≠ the requested action | Rejected |
| Proof from another request | Request seal or nonce mismatch | Rejected |
| Wrong environment | A staging proof on a production server, or the reverse; or World's response in another environment | Rejected |
| Not registered | Protected action on a server without World ID | `unavailable`: execution disabled, requirements shown |

**UI states** (Execute → step 6, `HumanPill`):
- Verification required, Verification in progress, Checking with World, Verified, Rejected, Expired, Cancelled, Unavailable.
- Step 6 shows the binding: "bound to strategy … version …, plan …, action aqua:ship, a single-use challenge and a 10-minute expiry".
- After authorization, the human status and the bound version and plan are shown from the stored record.
- The Integrations panel reports World ID as BLOCKED (not registered, shipping disabled), IMPLEMENTED BUT NOT VERIFIED, or VERIFIED TESTNET (counted from authorizations World actually verified).

## 3. Tests (`npm run test:unit`: 110 passed, 0 failed, 0 skipped)

World's verify API is replaced by a **test double**, and the RP signing key is generated locally for the tests. These tests prove TRACE's own checks. **They are not a real World ID verification.**

| Brief requirement | Test |
|---|---|
| Successful verification (logic) | `api.test.mjs` "full authorization flow…": challenge → IDKit-shaped result → wallet signature → 200 `validated`, `worldId: verified`, nullifier stored. `world.test.mjs` "a valid proof…". The verify call receives the IDKit result unchanged at `/api/v4/verify/{rp_id}` |
| Invalid proof rejected | `api.test.mjs` "an invalid proof is rejected…" (403, `rejected`). `world.test.mjs`: API 400, `success:false`, network error, wrong-environment answer, missing nullifier → never verified |
| Expired proof rejected | `world.test.mjs` "expired…" (request past `expires_at` → `expired`). `authorization.test.mjs` "expired authorization is rejected" |
| Replay rejected | `api.test.mjs` "a replayed proof is rejected" (`replayed`), plus "full flow" replay. `authorization.test.mjs` "replayed challenge is rejected" |
| Modified plan rejected | `api.test.mjs` "a changed plan hash or strategy version is rejected even with a valid human proof". `world.test.mjs` "modified plan or strategy version…" (signal mismatch). `authorization.test.mjs` tampered or mismatched plan |
| Wrong action / other request / environment | `world.test.mjs` "a proof for another request, a forged request seal, another nonce, action or environment…". `api.test.mjs` "a proof generated for another authorization…" |
| Cancelled | `api.test.mjs` "a cancelled verification (no proof)…" (`required`, 403) |
| Protected action blocked without proof | `api.test.mjs` "the wallet signature alone never counts…" (no proof → 403; a validated but unverified row → 403 at the ship gate). "World ID not registered: protected execution is disabled…" (`unavailable` with exact requirements) |
| Dock unaffected | `api.test.mjs` "dock … is not a protected action" |
| UI | `e2e/trace.spec.ts`: the existing wallet-flow test now mocks a non-enforcing server, and a new test checks execution is disabled with the requirements shown when World ID is enforced but not registered. **Not run here** (no browser or network in this environment) |

## 4. Live evidence

- **Production before this change** (`GET /integrations`, real): `world_id` = BLOCKED BY EXTERNAL DEPENDENCY, "WORLD_RP_ID / WORLD_RP_SIGNING_KEY not configured". No World ID proof has ever been verified by TRACE.
- **After deploy:** shipping from TRACE is disabled ("protected execution (aqua:ship) is disabled until WORLD_APP_ID, WORLD_RP_ID and WORLD_RP_SIGNING_KEY are set"). Dock still works.

## 5. Exact requirements to verify live

1. At **developer.world.org**, create an app and enable World ID 4.0. Note the `app_id` (`app_…`), the `rp_id` (`rp_…`) and the **RP signing key** (secret).
2. On Render (trace-api → Environment), set `WORLD_APP_ID`, `WORLD_RP_ID` and `WORLD_RP_SIGNING_KEY`. Paste them yourself; TRACE never handles secrets in a browser form. Keep `WORLD_ENVIRONMENT=staging` to use the **World ID simulator** (https://simulator.worldcoin.org), or set `production` to use a real World App.
3. In the app, go to Execute → step 6 → "Verify with World ID and sign", scan with the simulator (or World App), then sign in your wallet.
4. TRACE then records a real verification by World's API. Integrations shows VERIFIED TESTNET, and the authorization row holds `world_status = verified` and a nullifier. That evidence (authorization id, timestamp, environment) goes into this section.
5. To finish the Phase 4 live proof in the same pass, continue to step 7 (approve and ship a small USDC/WETH strategy).

Optional: `WORLD_ID_ENFORCE=false` turns the requirement off for demos. The UI and Integrations then say plainly that shipping is **not** protected.
