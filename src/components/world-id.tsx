"use client";

/**
 * World ID 4.0 verification for one authorization (official IDKit React widget).
 * The request — app id, action, signed RP context and the signal that binds the
 * proof to this exact plan, strategy version, action and challenge — comes from
 * the server (POST /plans/:id/challenge); nothing here is signed in the browser.
 * The proof is returned unchanged to the caller and verified by the server.
 */

import { IDKitRequestWidget, orbLegacy, type IDKitResult } from "@worldcoin/idkit";
import type { WorldRequest } from "@/lib/api";

export default function WorldIdVerify({
  request,
  onSuccess,
  onError,
}: {
  request: WorldRequest;
  onSuccess: (result: Record<string, unknown>) => void;
  onError: (code: string) => void;
}) {
  return (
    <IDKitRequestWidget
      open
      onOpenChange={(open) => {
        if (!open) onError("closed");
      }}
      app_id={request.app_id}
      action={request.action}
      rp_context={request.rp_context}
      environment={request.environment}
      allow_legacy_proofs
      preset={orbLegacy({ signal: request.signal })}
      action_description="Approve this exact TRACE execution plan"
      onSuccess={(result: IDKitResult) => onSuccess(result as unknown as Record<string, unknown>)}
      onError={(code) => onError(String(code))}
    />
  );
}
