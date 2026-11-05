import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

/** Client wrapper so interactive pages keep the app shell + demo banner. */
export function Page({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
