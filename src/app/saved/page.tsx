"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/ui";

/** Strategy versions now live on Strategy → Versions; keep old links working. */
export default function SavedRedirect() {
  const router = useRouter();
  useEffect(() => {
    const inv = new URLSearchParams(window.location.search).get("inv");
    router.replace(`/strategy?tab=versions${inv ? `&inv=${encodeURIComponent(inv)}` : ""}`);
  }, [router]);
  return <LoadingState label="Strategy versions moved to Strategy → Versions…" />;
}
