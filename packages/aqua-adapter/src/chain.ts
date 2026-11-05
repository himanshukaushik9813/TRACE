/**
 * Real Sepolia reads for the Aqua compatibility checks and for verifying
 * execution outcomes. Server-side only (uses the server's RPC URL).
 */

import { createPublicClient, erc20Abi, getAddress, http, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { AQUA } from "@trace/chain-config";
import type { CompatibilityCheck, ExecutionPlan } from "@trace/strategy-ir";

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

  /** On-chain checks for a maker shipping (token0, token1) amounts to Aqua. */
  async function makerChecks(maker: string | null, tokens: { address: string; symbol: string; amount?: bigint }[]): Promise<CompatibilityCheck[]> {
    const out: CompatibilityCheck[] = [];
    const [reg, app, kyc] = await Promise.all([hasCode(AQUA.registry.address), hasCode(AQUA.swapVmRouter.address), hasCode(AQUA.kycNft.address)]);
    out.push({ key: "aqua.registry", label: "Aqua registry deployed on Sepolia", ok: reg, detail: AQUA.registry.address, source: "chain" });
    out.push({ key: "aqua.router", label: "AquaSwapVMRouter deployed on Sepolia", ok: app, detail: AQUA.swapVmRouter.address, source: "chain" });
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

  return { hasCode, makerChecks, simulateStep, verifyTx };
}
