# Testnet setup

## 1. Network
- **Chain:** Ethereum Sepolia, chain id `11155111`, block explorer https://sepolia.etherscan.io
- **Wallet:** MetaMask with Sepolia enabled (Settings → Advanced → Show test networks). TRACE asks to switch to Sepolia when you connect, and disables signing on any other chain.
- **Test ETH:** use a Sepolia faucet (e.g. Google Cloud Web3 faucet, Alchemy or Infura faucets).

## 2. Accounts and keys
| What | Where | Notes |
|---|---|---|
| Sepolia RPC | Infura / Alchemy / QuickNode | `SEPOLIA_RPC_URL`, server only |
| Postgres | Supabase project | `DATABASE_URL`. Use the **session pooler** on IPv4 networks. |
| Redis | Upstash | `REDIS_URL` (`rediss://…`) |
| 0G Router key | https://pc.0g.ai | `ZERO_G_API_KEY`. Pick a trust mode that has providers (see `GET /v1/models`). |
| 0G Storage uploader | `cast wallet new`, then fund at https://faucet.0g.ai | `OG_STORAGE_PRIVATE_KEY` — a dedicated testnet-only burner |

## 3. Install and run
```bash
npm install
cp .env.example .env.local      # fill in the values above
npm run db:migrate              # applies db/migrations to DATABASE_URL
npm run build:server            # packages → dist, server → server/dist
npm run start:server            # API + worker on :4000 (prints config and integration status)
npm run build && npm run start  # web app on :3000  (or: npm run dev)
```

## 4. Create demo positions with your own wallet
1. Wrap a little Sepolia ETH to WETH (`0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`) and swap some for USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) on app.uniswap.org with Sepolia selected.
2. Add liquidity to **WETH/USDC** (actively traded on Sepolia) in a concentrated range. Then collect fees, remove some liquidity, and open a second position with a different range. This gives TRACE a real history to analyse and real swaps to backtest against.
3. Investigate your wallet in TRACE (use **Use connected wallet**).

## 5. Verify
```bash
curl localhost:4000/health
curl localhost:4000/integrations | jq '.integrations[] | {label, status}'
npm test            # unit + API tests (real captured Sepolia data)
npm run test:live   # live Sepolia reads
npm run test:fork   # real Aqua contracts on an Anvil fork (Foundry required)
npm run test:e2e    # Playwright against the running app
```
