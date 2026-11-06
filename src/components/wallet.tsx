"use client";

/**
 * Real wallet connectivity (wagmi + injected/MetaMask), Sepolia only.
 *  - WalletButton: connect / disconnect, shows the ACTUAL connected address.
 *  - NetworkBanner: wrong-network detection with a one-click switch to Sepolia.
 *  - useSepoliaWallet: the guard every signing flow uses.
 * No address is ever assumed; nothing is signed without an explicit click.
 */

import { useEffect, useRef, useState } from "react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { AlertTriangle, LogOut, Wallet } from "lucide-react";
import { SEPOLIA_CHAIN, SEPOLIA_CHAIN_ID, CHAIN_LABEL } from "@trace/chain-config";
import { fmt } from "@/lib/format";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

const SEPOLIA_HEX = `0x${SEPOLIA_CHAIN_ID.toString(16)}`;

/**
 * Switch the wallet to Sepolia with ONE direct EIP-1193 request.
 *
 * wagmi's switchChain fires wallet_switchEthereumChain and, on some errors, a
 * follow-up wallet_addEthereumChain with library-default RPCs while MetaMask's
 * popup is still open — some MetaMask versions crash that popup with
 * "Cannot read properties of undefined (reading 'origin')". Here we send a
 * single switch request; only if MetaMask reports the chain as unknown (4902)
 * do we add Sepolia with explicit, known-good parameters. The UI updates from
 * the wallet's own `chainChanged` event, never from an assumption.
 */
const errCode = (e: unknown) =>
  (e as { code?: number }).code ?? (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;

/**
 * Newer MetaMask versions grant networks per site. Switching to a chain the
 * site was not connected with opens a "Review permissions · Use your enabled
 * networks" approval inside wallet_switchEthereumChain — and that screen
 * crashes in some MetaMask versions ("reading 'origin'"). Requesting the
 * Sepolia network permission through the standard wallet_requestPermissions
 * flow (the same flow as connecting) avoids that screen: once Sepolia is
 * permitted, the switch needs no further approval.
 * Returns false when the wallet does not support chain permissions.
 */
async function requestSepoliaPermission(provider: Eip1193): Promise<boolean> {
  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {}, "endowment:permitted-chains": { caveats: [{ type: "restrictNetworkSwitching", value: [SEPOLIA_HEX] }] } }],
    });
    return true;
  } catch (e) {
    if (errCode(e) === 4001) throw e; // user rejected
    return false; // not supported by this wallet — fall back to a plain switch
  }
}

/** A wallet popup that crashes never resolves; don't leave the UI waiting forever. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error("MetaMask did not respond. Close its popup and select Sepolia in MetaMask's network menu — TRACE will detect it.")), ms),
    ),
  ]);
}

async function switchProviderToSepolia(provider: Eip1193): Promise<void> {
  await withTimeout(requestSepoliaPermission(provider), 90_000);
  try {
    await withTimeout(provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_HEX }] }), 60_000);
  } catch (err) {
    if (errCode(err) !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA_HEX,
          chainName: SEPOLIA_CHAIN.name,
          nativeCurrency: SEPOLIA_CHAIN.nativeCurrency,
          rpcUrls: [SEPOLIA_CHAIN.publicRpc],
          blockExplorerUrls: [SEPOLIA_CHAIN.explorerUrl],
        },
      ],
    });
  }
}

export function useSepoliaWallet() {
  const conn = useConnection();
  const [switching, setSwitching] = useState(false);
  const inFlight = useRef(false);
  const connected = conn.status === "connected" && Boolean(conn.address);
  const onSepolia = connected && conn.chainId === SEPOLIA_CHAIN_ID;
  return {
    address: conn.address ?? null,
    chainId: conn.chainId ?? null,
    connected,
    onSepolia,
    switching,
    switchToSepolia: async () => {
      if (inFlight.current) return; // never stack wallet popups
      inFlight.current = true;
      setSwitching(true);
      try {
        const provider = (await conn.connector?.getProvider()) as Eip1193 | undefined;
        if (!provider) throw new Error("Wallet provider unavailable — reconnect your wallet");
        await switchProviderToSepolia(provider);
      } finally {
        inFlight.current = false;
        setSwitching(false);
      }
    },
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

  if (!mounted) return <div className="h-9 w-[132px] rounded-md2 border border-line bg-ivory-50" />;

  if (!w.connected) {
    // Prefer MetaMask's own EIP-6963 provider over the generic window.ethereum
    // shim (other extensions can hijack window.ethereum).
    const connector = connectors.find((c) => c.id === "io.metamask") ?? connectors.find((c) => c.type === "injected") ?? connectors[0];
    return (
      <div className="flex flex-col items-end">
        <button
          onClick={async () => {
            setErr(null);
            if (!connector) return setErr("No browser wallet found — install MetaMask");
            try {
              // 1) One standard permission request for the account AND the Sepolia
              //    network (so a later switch needs no per-site network approval).
              // 2) wagmi connect (eth_requestAccounts — already permitted, no popup).
              // No chain switch is chained into the connect: if the wallet is not on
              // Sepolia, the NetworkBanner asks the user to switch explicitly.
              const provider = (await connector.getProvider()) as Eip1193 | undefined;
              if (provider) await withTimeout(requestSepoliaPermission(provider), 120_000);
              await connect({ connector });
            } catch (e) {
              setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
            }
          }}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md2 border border-line bg-ivory-50 text-ink px-3 h-9 text-[0.8rem] font-medium shadow-soft hover:border-gold/45 disabled:opacity-50"
        >
          <Wallet size={15} className="text-gold" />
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
          w.onSepolia ? "border-line bg-ivory-50 text-ink shadow-soft" : "border-brick/40 bg-brick/8 text-brick"
        }`}
        title={w.address ?? ""}
      >
        <span className={`h-2 w-2 rounded-full ${w.onSepolia ? "bg-forest" : "bg-brick"}`} />
        <span className="tabular font-medium">{fmt.addr(w.address ?? "")}</span>
        <span className="hidden lg:inline text-ink-600">· {w.onSepolia ? "Sepolia" : `chain ${w.chainId}`}</span>
      </div>
      <button onClick={() => disconnect()} aria-label="Disconnect wallet" title="Disconnect wallet" className="grid place-items-center h-9 w-9 rounded-md2 border border-line bg-ivory-50 hover:bg-ivory-100">
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
            const code = (e as { code?: number }).code;
            setErr(code === 4001 ? "You rejected the network switch." : ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message));
          }
        }}
        disabled={w.switching}
        className="rounded-md2 bg-brick text-ivory-50 px-3 py-1 text-[0.78rem] font-medium hover:opacity-90 disabled:opacity-50"
      >
        {w.switching ? "Confirm in wallet…" : "Switch to Sepolia"}
      </button>
      <span className="text-[0.72rem] text-brick/80">
        Or select <strong>Sepolia</strong> in MetaMask&apos;s network menu — TRACE detects the change automatically.
      </span>
      {err && <span className="text-[0.74rem]">{err}</span>}
    </div>
  );
}
