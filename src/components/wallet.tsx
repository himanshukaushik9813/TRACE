"use client";

/**
 * Real wallet connectivity (wagmi + injected/MetaMask), Sepolia only.
 *  - WalletButton: connect / disconnect, shows the ACTUAL connected address.
 *  - NetworkBanner: wrong-network detection with a one-click switch to Sepolia.
 *  - useSepoliaWallet: the guard every signing flow uses.
 * No address is ever assumed; nothing is signed without an explicit click.
 */

import { useEffect, useState } from "react";
import { useConnect, useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { AlertTriangle, LogOut, Wallet } from "lucide-react";
import { SEPOLIA_CHAIN_ID, CHAIN_LABEL } from "@trace/chain-config";
import { fmt } from "@/lib/format";

export function useSepoliaWallet() {
  const conn = useConnection();
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain();
  const connected = conn.status === "connected" && Boolean(conn.address);
  const onSepolia = connected && conn.chainId === SEPOLIA_CHAIN_ID;
  return {
    address: conn.address ?? null,
    chainId: conn.chainId ?? null,
    connected,
    onSepolia,
    switching,
    switchToSepolia: () => switchChain({ chainId: SEPOLIA_CHAIN_ID }),
  };
}

/** Avoid hydration mismatch: wallet state only exists in the browser. */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function WalletButton() {
  const mounted = useMounted();
  const w = useSepoliaWallet();
  const { mutateAsync: connect, connectors, isPending, error } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const [err, setErr] = useState<string | null>(null);

  if (!mounted) return <div className="h-9 w-[132px] rounded-md2 border border-ink/10 bg-ivory-50" />;

  if (!w.connected) {
    const injected = connectors[0];
    return (
      <div className="flex flex-col items-end">
        <button
          onClick={async () => {
            setErr(null);
            if (!injected) return setErr("No browser wallet found — install MetaMask");
            try {
              await connect({ connector: injected, chainId: SEPOLIA_CHAIN_ID });
            } catch (e) {
              setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
            }
          }}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md2 bg-ink text-ivory-50 px-3 h-9 text-[0.8rem] font-medium hover:bg-graphite disabled:opacity-50"
        >
          <Wallet size={15} className="text-gold-300" />
          {isPending ? "Confirm in wallet…" : "Connect wallet"}
        </button>
        {(err || error) && <span className="text-[0.62rem] text-brick mt-0.5 max-w-[220px] text-right">{err ?? error?.message}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`inline-flex items-center gap-2 rounded-md2 border px-2.5 h-9 text-[0.76rem] ${
          w.onSepolia ? "border-sage/40 bg-sage/8 text-ink" : "border-brick/40 bg-brick/8 text-brick"
        }`}
        title={w.address ?? ""}
      >
        <span className={`h-2 w-2 rounded-full ${w.onSepolia ? "bg-sage" : "bg-brick"}`} />
        <span className="tabular font-medium">{fmt.addr(w.address ?? "")}</span>
        <span className="hidden lg:inline text-ink-600">· {w.onSepolia ? "Sepolia" : `chain ${w.chainId}`}</span>
      </div>
      <button onClick={() => disconnect()} aria-label="Disconnect wallet" className="grid place-items-center h-9 w-9 rounded-md2 border border-ink/10 bg-ivory-50 hover:bg-ink/5">
        <LogOut size={15} className="text-ink-600" />
      </button>
    </div>
  );
}

/** Wrong-network banner; rendered app-wide under the top bar. */
export function NetworkBanner() {
  const mounted = useMounted();
  const w = useSepoliaWallet();
  const [err, setErr] = useState<string | null>(null);
  if (!mounted || !w.connected || w.onSepolia) return null;
  return (
    <div className="bg-brick/10 border-b border-brick/30 px-4 md:px-6 py-2.5 flex flex-wrap items-center gap-3 text-[0.82rem] text-brick" role="alert">
      <AlertTriangle size={16} />
      <span>
        Your wallet is on chain {w.chainId}. TRACE only runs on <strong>{CHAIN_LABEL}</strong> ({SEPOLIA_CHAIN_ID}); signing is disabled until you switch.
      </span>
      <button
        onClick={async () => {
          setErr(null);
          try {
            await w.switchToSepolia();
          } catch (e) {
            setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
          }
        }}
        disabled={w.switching}
        className="rounded-md2 bg-brick text-ivory-50 px-3 py-1 text-[0.78rem] font-medium hover:opacity-90 disabled:opacity-50"
      >
        {w.switching ? "Switching…" : "Switch to Sepolia"}
      </button>
      {err && <span className="text-[0.74rem]">{err}</span>}
    </div>
  );
}
