import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

/** Wraps every screen in the app shell (navigation, Sepolia indicator, wallet, network guard). */
export function Page({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
