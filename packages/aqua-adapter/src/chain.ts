/**
 * Real Sepolia reads for the Aqua compatibility checks and for verifying
 * execution outcomes. Server-side only (uses the server's RPC URL).
 */

import { createRequire } from "node:module";
import { createPublicClient, erc20Abi, getAddress, http, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { AQUA, AQUA_PRODUCTION } from "@trace/chain-config";
import type { CompatibilityCheck, ExecutionPlan } from "@trace/strategy-ir";
import { humanPriceFromSqrt1e18 } from "./price.js";

const require = createRequire(import.meta.url);
const SVM = require("@1inch/swap-vm-sdk") as typeof import("@1inch/swap-vm-sdk");

const POOL_ABI = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"]);
const ROUTER_ABI = parseAbi(["function AQUA() view returns (address)"]);

export type StrategyState = {
  checkedAt: number;
  block: number;
  registry: string;
  app: string;
  strategyHash: string;
  tokens: { symbol: string; address: string; planned: string; balance: string; registered: boolean }[];
  /** "active": balances as shipped; "docked": all zero; "partly_filled": balances moved by swaps; "not_shipped". */
  status: "active" | "docked" | "partly_filled" | "not_shipped";
  quotes: { direction: string; amountIn: string; amountOut: string; orderHashMatches: boolean; price: number | null; insideRange: boolean | null; error?: string }[];
  checks: { key: string; ok: boolean; detail: string }[];
};

const AQUA_ABI = parseAbi([
  "function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)",
  "event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)",
  "event Docked(address maker, address app, bytes32 strategyHash)",
]);
const KYC_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export function aquaClient(rpcUrl: string) {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });

  async function hasCode(a: string): Promise<boolean> {
    const c = await client.getCode({ address: a as Address });
    return Boolean(c && c !== "0x");
  }

  /** The basis pool's current price (slot0), read on-chain. */
  async function poolSpot(pool: string): Promise<{ sqrtPriceX96: string; tick: number; block: number }> {
    const [s0, block] = await Promise.all([client.readContract({ address: pool as Address, abi: POOL_ABI, functionName: "slot0" }), client.getBlockNumber()]);
    return { sqrtPriceX96: s0[0].toString(), tick: Number(s0[1]), block: Number(block) };
  }

  /** On-chain checks for a maker shipping (token0, token1) amounts to Aqua. */
  async function makerChecks(maker: string | null, tokens: { address: string; symbol: string; amount?: bigint }[]): Promise<CompatibilityCheck[]> {
    const out: CompatibilityCheck[] = [];
    const [reg, app, kyc] = await Promise.all([hasCode(AQUA.registry.address), hasCode(AQUA.swapVmRouter.address), hasCode(AQUA.kycNft.address)]);
    out.push({ key: "aqua.registry", label: "Aqua registry deployed on Sepolia", ok: reg, detail: AQUA.registry.address, source: "chain" });
    out.push({ key: "aqua.router", label: "AquaSwapVMRouter deployed on Sepolia", ok: app, detail: AQUA.swapVmRouter.address, source: "chain" });
    if (app) {
      const linked = await client.readContract({ address: AQUA.swapVmRouter.address as Address, abi: ROUTER_ABI, functionName: "AQUA" }).catch(() => null);
      out.push({
        key: "aqua.router.registry",
        label: "Router reads balances from this registry",
        ok: Boolean(linked && getAddress(linked) === getAddress(AQUA.registry.address)),
        detail: linked ? `router.AQUA() = ${getAddress(linked)}` : "router.AQUA() unreadable",
        source: "chain",
      });
    }
    const prod = await hasCode(AQUA_PRODUCTION.swapVmRouter.address).catch(() => false);
    out.push({
      key: "info.production_router",
      label: "Current production router on Sepolia",
      ok: prod,
      detail: prod
        ? `${AQUA_PRODUCTION.swapVmRouter.address} is deployed on Sepolia`
        : `${AQUA_PRODUCTION.swapVmRouter.address} (current production router) has no code on Sepolia; TRACE uses 1inch's documented Sepolia test pair instead`,
      source: "chain",
    });
    for (const t of tokens) {
      const code = await hasCode(t.address);
      out.push({ key: `token.${t.symbol}`, label: `${t.symbol} contract exists`, ok: code, detail: t.address, source: "chain" });
    }
    if (maker) {
      for (const t of tokens) {
        const [bal, allowance] = await Promise.all([
          client.readContract({ address: t.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [maker as Address] }),
          client.readContract({ address: t.address as Address, abi: erc20Abi, functionName: "allowance", args: [maker as Address, AQUA.registry.address] }),
        ]);
        const need = t.amount ?? 0n;
        out.push({
          key: `maker.balance.${t.symbol}`,
          label: `Maker holds ${t.symbol}`,
          ok: bal > 0n && bal >= need,
          detail: `balance ${bal.toString()} base units${need ? `, plan needs ${need.toString()}` : ""} (Aqua pulls from the wallet when swaps fill)`,
          source: "chain",
        });
        out.push({
          key: `maker.allowance.${t.symbol}`,
          label: `${t.symbol} allowance to Aqua`,
          ok: need > 0n ? allowance >= need : true,
          detail: `current allowance ${allowance.toString()}; an exact-amount approve step is included in the plan`,
          source: "chain",
        });
      }
      if (kyc) {
        const k = await client.readContract({ address: AQUA.kycNft.address, abi: KYC_ABI, functionName: "balanceOf", args: [maker as Address] });
        out.push({
          key: "taker.kyc",
          label: "Wallet holds the 1inch KycNFT (needed only to act as a taker / swap)",
          ok: k > 0n,
          detail: k > 0n ? "KycNFT held" : "No KycNFT — the swap (taker) leg is blocked by the protocol; ship/dock are unaffected",
          source: "chain",
        });
      }
    }
    return out;
  }

  /** Simulate a plan step from the maker (eth_call) — catches ABI/registry mismatches before signing. */
  async function simulateStep(from: string, step: { to: string; data: string; value: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      await client.call({ account: from as Address, to: step.to as Address, data: step.data as Hex, value: BigInt(step.value) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as { shortMessage?: string }).shortMessage ?? String((err as Error).message).slice(0, 300) };
    }
  }

  /** Verify a submitted tx: receipt status, confirmations, and the expected Aqua event / balances. */
  async function verifyTx(hash: string, plan: ExecutionPlan, op: "approve" | "ship" | "dock" | "swap") {
    const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
    const latest = await client.getBlockNumber();
    const confirmations = Number(latest - receipt.blockNumber) + 1;
    const tx = await client.getTransaction({ hash: hash as Hex });
    const out = {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      confirmations,
      from: getAddress(receipt.from),
      to: receipt.to ? getAddress(receipt.to) : null,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: (receipt.effectiveGasPrice ?? 0n).toString(),
      matchesPlan: false,
      outcome: "" as string,
    };
    const step = plan.steps.find((s) => s.op === op);
    out.matchesPlan = Boolean(step && tx.to && getAddress(tx.to) === getAddress(step.to) && tx.input.toLowerCase() === step.data.toLowerCase());
    if (receipt.status !== "success") {
      out.outcome = "transaction reverted";
      return out;
    }
    if (op === "ship" || op === "dock") {
      const logs = parseEventLogs({ abi: AQUA_ABI, logs: receipt.logs, strict: false });
      const ev = logs.find((l) => l.eventName === (op === "ship" ? "Shipped" : "Docked"));
      const balances = await Promise.all(
        plan.tokens.map((t) =>
          client
            .readContract({
              address: plan.registry as Address,
              abi: AQUA_ABI,
              functionName: "rawBalances",
              args: [plan.maker as Address, plan.app as Address, plan.strategyHash as Hex, t.address as Address],
            })
            .then((r) => `${t.symbol}=${r[0].toString()}`)
            .catch(() => `${t.symbol}=unreadable`),
        ),
      );
      out.outcome = `${ev ? `${ev.eventName} event emitted` : `no ${op === "ship" ? "Shipped" : "Docked"} event found`}; virtual balances now ${balances.join(", ")}`;
    } else {
      out.outcome = "receipt status success";
    }
    return out;
  }

  /**
   * Read a shipped strategy's live state: virtual balances per token (registry
   * rawBalances) and a read-only router quote in each fillable direction, checking
   * that the router prices this exact order (same order hash) inside its range.
   */
  async function strategyState(plan: ExecutionPlan): Promise<StrategyState> {
    const RAW = parseAbi(["function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)"]);
    const block = Number(await client.getBlockNumber());
    const raw = await Promise.all(
      plan.tokens.map((t) => client.readContract({ address: plan.registry as Address, abi: RAW, functionName: "rawBalances", args: [plan.maker as Address, plan.app as Address, plan.strategyHash as Hex, t.address as Address] })),
    );
    const tokens = plan.tokens.map((t, i) => ({ symbol: t.symbol, address: t.address, planned: t.amount, balance: raw[i][0].toString(), registered: raw[i][1] > 0 }));
    const registered = tokens.every((t) => t.registered);
    const allZero = tokens.every((t) => t.balance === "0");
    const asShipped = tokens.every((t) => t.balance === t.planned);
    const status: StrategyState["status"] = !tokens.some((t) => t.registered) ? "not_shipped" : allZero ? "docked" : asShipped ? "active" : "partly_filled";

    const quotes: StrategyState["quotes"] = [];
    const sqrtSpot = BigInt(plan.allocation?.spot.sqrtPrice1e18 ?? "0");
    const lo = Number(plan.params.sqrtPriceMin);
    const hi = Number(plan.params.sqrtPriceMax);
    if (registered && !allZero && plan.tokens.length === 2) {
      const order = SVM.Order.decode(new SVM.HexString(plan.order));
      for (const dir of [0, 1] as const) {
        const tin = plan.tokens[dir];
        const tout = plan.tokens[1 - dir];
        const outBal = BigInt(tokens[1 - dir].balance);
        if (outBal === 0n) continue;
        // Ask for about 1/1000 of the out-side balance, priced at the spot the plan was sized with.
        const p2 = sqrtSpot > 0n ? sqrtSpot * sqrtSpot : 10n ** 36n;
        let amountIn = dir === 0 ? (outBal * 10n ** 36n) / (p2 * 1000n) : (outBal * p2) / (10n ** 36n * 1000n);
        if (amountIn < 1n) amountIn = 1n;
        const data = SVM.SwapVMContract.encodeQuoteCallData({ order, tokenIn: new SVM.Address(tin.address), tokenOut: new SVM.Address(tout.address), amount: amountIn, takerTraits: SVM.TakerTraits.default() });
        const direction = `${tin.symbol} → ${tout.symbol}`;
        try {
          const res = await client.call({ account: plan.maker as Address, to: plan.app as Address, data: data.toString() as Hex });
          const hex = (res.data ?? "0x").slice(2);
          const aIn = BigInt(`0x${hex.slice(0, 64)}`);
          const aOut = BigInt(`0x${hex.slice(64, 128)}`);
          const oh = `0x${hex.slice(128, 192)}`;
          // Raw price token1/token0 in base units; sqrt in 1e18 fixed point for the range test.
          const pRaw = dir === 0 ? Number(aOut) / Number(aIn) : Number(aIn) / Number(aOut);
          const sqrtExec = Math.sqrt(pRaw) * 1e18;
          const fee = (plan.params.feeBps / 10_000) * 2;
          const inside = lo === 0 && hi === 0 ? null : sqrtExec >= lo * Math.sqrt(1 - fee) && sqrtExec <= hi * Math.sqrt(1 + fee);
          quotes.push({
            direction,
            amountIn: aIn.toString(),
            amountOut: aOut.toString(),
            orderHashMatches: oh.toLowerCase() === plan.strategyHash.toLowerCase(),
            price: aOut > 0n ? humanPriceFromSqrt1e18(BigInt(Math.round(sqrtExec)), plan.tokens[0].decimals, plan.tokens[1].decimals) : null,
            insideRange: inside,
          });
        } catch (err) {
          quotes.push({ direction, amountIn: amountIn.toString(), amountOut: "0", orderHashMatches: false, price: null, insideRange: null, error: (err as { shortMessage?: string }).shortMessage ?? String((err as Error).message).slice(0, 200) });
        }
      }
    }
    const checks = [
      { key: "state.registered", ok: registered, detail: `tokens registered in the strategy: ${tokens.map((t) => `${t.symbol} ${t.registered ? "yes" : "no"}`).join(", ")}` },
      { key: "state.balances", ok: status === "active" || status === "partly_filled", detail: `virtual balances ${tokens.map((t) => `${t.symbol}=${t.balance}`).join(", ")} (shipped ${tokens.map((t) => `${t.symbol}=${t.planned}`).join(", ")})` },
      ...quotes.map((q) => ({
        key: `state.quote.${q.direction}`,
        ok: !q.error && q.orderHashMatches && q.insideRange !== false,
        detail: q.error ? `router quote ${q.direction} reverted: ${q.error}` : `router quote ${q.direction}: ${q.amountIn} in → ${q.amountOut} out; order hash ${q.orderHashMatches ? "matches" : "DOES NOT match"}; price ${q.price?.toPrecision(6) ?? "—"} ${q.insideRange === null ? "" : q.insideRange ? "inside the range" : "OUTSIDE the range"}`,
      })),
    ];
    return { checkedAt: Math.floor(Date.now() / 1000), block, registry: plan.registry, app: plan.app, strategyHash: plan.strategyHash, tokens, status, quotes, checks };
  }

  return { hasCode, makerChecks, simulateStep, verifyTx, poolSpot, strategyState };
}
