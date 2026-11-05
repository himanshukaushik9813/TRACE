# Security

## Chain safety
- **Sepolia only.**
  - `chain-config.assertSupportedChain` is used everywhere.
  - The server refuses to start on any other `TRACE_CHAIN_ID` or on an RPC URL that looks like mainnet, and `eth_chainId` is asserted before any read.
  - The wagmi config contains only Sepolia.
  - Signing is disabled while the wallet is on another chain (a banner offers a switch).
  - The EIP-712 domain and the database `CHECK`s pin chain id 11155111.
- **No private keys from users.** Users sign in their own wallet. TRACE never asks for a key or seed phrase and stores neither. The only key on the server is the dedicated, testnet-only 0G Storage uploader.

## Authorization and replay
- Execution requires a server-verified EIP-712 signature binding:
  - wallet
  - chain id
  - strategy id and exact version hash
  - plan hash
  - action (`aqua:ship` or `aqua:dock`)
  - a 32-byte server-issued challenge
  - expiry (at most 10 minutes; anything further than 1 hour out is rejected)
- The signature is checked *before* the challenge is consumed, so invalid signatures can't burn challenges. The challenge is then consumed with a single conditional `UPDATE`, so a replay fails.
- `POST /transactions` refuses any op the authorization does not cover (a ship authorization cannot dock).
  - Each recorded transaction is re-verified from its receipt: sender equals the authorized wallet, and the calldata matches the plan step.
- Optional World ID: the proof signal is bound to the same claims, the RP signature is made server-side, and nullifiers are unique per action.

## Transaction construction
- Plans are compiled deterministically with the official 1inch SDKs, never from model output.
- The model can only propose a structured hypothesis, which the gate validates against the transaction evidence.
- Approvals are **exact amounts** to the Aqua registry. The plan validator rejects anything that's effectively unlimited.
- Every pre-ship step is simulated with `eth_call` from the maker before the user is asked to sign.

## Secrets
- `.env.local` is gitignored and mode 600. Only `NEXT_PUBLIC_*` values reach the browser, and the browser uses a keyless public RPC for reads.
- RPC URLs contain provider keys, and viem errors embed the URL. All chain errors go through `scrubSecrets` before logging, storage or API responses.
- The API error handler returns scrubbed messages and no stack traces.
- The startup config report prints only whether each variable is set, never its value.

## API hardening
- CORS is restricted to configured origins.
- Input validation covers addresses, integer windows, base-unit amounts, tx hashes and action names.
- Expensive routes are rate-limited per IP.
- JSON bodies are capped at 1 MB.
- Postgres access is parameterised throughout.
- Raw events and strategy versions are immutable at the database level.

## Tested
`test/authorization.test.mjs` and `test/api.test.mjs` cover:
- valid signature
- tampered plan hash
- mismatched stored plan
- wrong signer
- expired authorization
- replayed challenge
- non-Sepolia chain
- challenge for a non-maker wallet
- scope enforcement
- execution without authorization
- CORS
- input validation
