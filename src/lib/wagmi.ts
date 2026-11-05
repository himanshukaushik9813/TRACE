/**
 * wagmi configuration — Ethereum Sepolia ONLY.
 *
 * - The only chain in the config is Sepolia: wagmi cannot switch the app to
 *   mainnet, and every write is additionally guarded by `useSepoliaWallet` + the NetworkBanner.
 * - Reads in the browser use a keyless public Sepolia RPC; the server's
 *   Infura key never reaches the browser. Writes go through the user's wallet.
 */

// `injected` comes from the wagmi root export: the "wagmi/connectors" barrel would
// pull in every third-party connector and its optional peer dependencies.
import { createConfig, http, injected } from "wagmi";
import { sepolia } from "wagmi/chains";
import { SEPOLIA_CHAIN } from "@trace/chain-config";

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_PUBLIC_RPC || SEPOLIA_CHAIN.publicRpc) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
