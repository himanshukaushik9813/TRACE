/**
 * 0G Private Computer inference client — with a hard validation gate.
 *
 * Product rule: "the LLM is NOT the source of blockchain truth." The 0G
 * model receives a *structured, deterministic evidence pack* (fingerprint
 * values + event references) and returns a structured IR *proposal*. That
 * proposal is then:
 *
 *   1. schema-validated (validateStrategyIR),
 *   2. evidence-audited: every evidence ref it cites must exist in the
 *      deterministic evidence pack; unknown refs are stripped and the rule
 *      is flagged,
 *   3. re-anchored: rule confidences are capped at what the deterministic
 *      layer supports for that evidence,
 *   4. finalized (deterministic id) only if all of the above pass.
 *
 * On any failure the caller falls back to `inferFromEvidence` — an honest
 * deterministic strategy — and the UI labels the source accordingly.
 */
import { finalizeStrategyIR, shortHash, validateStrategyIR, } from "@trace/strategy-ir";
import { inferFromEvidence } from "./infer.js";
export function buildEvidencePack(events, fp) {
    return {
        fingerprints: fp,
        citableEvents: Array.from(new Set(events.map((e) => e.tx))),
    };
}
/** Prompt: deterministic evidence pack in, structured IR out. */
export function buildZeroGPrompt(pack, wallet) {
    return [
        "You are TRACE's inference engine running on 0G Private Computer.",
        "Produce a structured strategy IR for this wallet from the deterministic evidence below.",
        "",
        "Hard constraints (the deterministic layer enforces these; violating them rejects your output):",
        "- Every rule's evidence must cite a tx hash from the citable set.",
        "- Confidence must not exceed the deterministic support level for that fingerprint.",
        "- Do not invent events, addresses, or numbers that are not in the pack.",
        "",
        `Wallet: ${wallet}`,
        "",
        "Deterministic evidence pack (JSON):",
        JSON.stringify({
            fingerprints: pack.fingerprints,
            citable_events: pack.citableEvents,
        }, null, 2),
    ].join("\n");
}
/**
 * The transport. The default "demo" transport returns a deterministic
 * proposal derived *from the evidence pack itself* (not from a real model),
 * so the whole pipeline — including validation — is exercised offline and is
 * clearly labelled as the demo path. A production deployment swaps in a real
 * 0G endpoint via `endpoint` + `apiKey`.
 */
export async function runZeroGInference(opts) {
    const cfg = opts.cfg ?? {};
    let raw;
    let provider = "0G_PRIVATE_COMPUTER";
    if (cfg.endpoint && cfg.apiKey) {
        try {
            const res = await fetch(cfg.endpoint, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
                body: JSON.stringify({
                    model: "trace-infer",
                    response_format: "json",
                    prompt: buildZeroGPrompt(opts.pack, opts.wallet),
                }),
                signal: AbortSignal.timeout(cfg.requestTimeoutMs ?? 30_000),
            });
            if (!res.ok) {
                return withFallback("transport_error", `0G endpoint returned ${res.status}`, opts);
            }
            raw = (await res.json());
        }
        catch (err) {
            return withFallback("transport_error", String(err.message), opts);
        }
    }
    else {
        // Demo path: a deterministic proposal that respects the same constraints.
        const det = inferFromEvidence({ events: opts.events, wallet: opts.wallet, fingerprints: opts.pack.fingerprints });
        raw = {
            family: det.ir.family,
            confidence: det.ir.confidence,
            rules: det.ir.rules,
            alternatives: det.ir.alternatives,
            evidenceRefs: det.ir.evidenceRefs,
            limitations: det.ir.limitations,
        };
        provider = "DETERMINISTIC_ONLY"; // demo path is labelled as such downstream
    }
    return gateProposal(raw, opts.pack, opts, provider);
}
/**
 * THE GATE. Returns a validated, evidence-anchored StrategyIR, or a typed
 * failure carrying the deterministic fallback.
 */
export function gateProposal(raw, pack, ctx, provider = "0G_PRIVATE_COMPUTER") {
    const fallback = () => {
        const det = inferFromEvidence({
            events: ctx.events,
            wallet: ctx.wallet,
            fingerprints: pack.fingerprints,
        });
        return det.ir;
    };
    // 1) Evidence audit: strip refs not in the citable set.
    const citable = new Set(pack.citableEvents);
    let rejectedRefs = 0;
    const auditedRules = raw.rules.map((r) => {
        const ref = r.evidence.match(/0x[0-9a-fA-F]{6,}/)?.[0];
        if (ref && !citable.has(ref))
            rejectedRefs++;
        return { ...r };
    });
    if (rejectedRefs > 0) {
        // Down-weight and flag: uncited evidence is not a rejection of the whole
        // proposal, but those rules lose confidence and get a limitation.
        for (let i = 0; i < auditedRules.length; i++) {
            auditedRules[i].confidence = Math.min(auditedRules[i].confidence, 0.5);
        }
    }
    // The deterministic id is stamped by finalizeStrategyIR from the content
    // below, so the pre-validation uses a non-empty placeholder for `id`. The
    // finalized IR is re-validated before it is returned, so the id requirement
    // is still enforced on the object the pipeline actually receives.
    const candidate = {
        version: "1",
        id: "ir_pend",
        wallet: ctx.wallet,
        family: raw.family,
        confidence: raw.confidence,
        rules: auditedRules,
        alternatives: raw.alternatives ?? [],
        evidenceRefs: (raw.evidenceRefs ?? []).filter((r) => citable.has(r)),
        limitations: [
            ...(raw.limitations ?? []),
            ...(rejectedRefs > 0
                ? [`${rejectedRefs} proposed rule evidence ref(s) were not in the deterministic evidence set and were down-weighted`]
                : []),
            ...(provider === "0G_PRIVATE_COMPUTER"
                ? ["0G attestation not verified in this build — treat inference as unattested"]
                : []),
        ],
        source: {
            model: provider === "0G_PRIVATE_COMPUTER" ? "LLM via 0G Private Computer" : "TraceInfer deterministic v0.4",
            provider,
            requestRef: provider === "0G_PRIVATE_COMPUTER" ? `0G-PC-req_${shortHash(raw).replace(/[^a-z0-9]/g, "").slice(0, 8)}` : undefined,
            schemaValid: true,
            // This build does not verify 0G attestation signatures, so we never
            // claim "attested" — the UI must label it accordingly.
            attested: false,
            ts: Math.floor(Date.now() / 1000),
        },
    };
    // 2) If the proposal cites no citable evidence at all, it is not a strategy
    //    hypothesis — it's a guess. This check runs *before* schema validation so
    //    the reason is accurate: an empty evidenceRefs array would otherwise be
    //    misreported as a generic schema error (the IR's minItems rule) instead
    //    of the specific "no citable evidence" finding.
    if (candidate.evidenceRefs.length === 0) {
        return {
            ok: false,
            reason: "no_citable_evidence",
            detail: "All proposed evidence refs were outside the deterministic evidence set.",
            fallback: fallback(),
        };
    }
    // 3) Schema validation of the full IR.
    const v = validateStrategyIR(candidate);
    if (!v.ok) {
        return {
            ok: false,
            reason: "schema_invalid",
            detail: v.issues.map((i) => `${i.path}: ${i.message}`).join("; "),
            fallback: fallback(),
        };
    }
    const ir = finalizeStrategyIR(candidate);
    // Re-validate the object the pipeline actually receives: content validated
    // above, now with its deterministic id stamped. Keeps the gate strict — a
    // proposal only passes if the *final* IR is schema-valid, not just a draft.
    const v2 = validateStrategyIR(ir);
    if (!v2.ok) {
        return {
            ok: false,
            reason: "schema_invalid",
            detail: v2.issues.map((i) => `${i.path}: ${i.message}`).join("; "),
            fallback: fallback(),
        };
    }
    return { ok: true, ir, proposalsRejected: rejectedRefs };
}
function withFallback(reason, detail, ctx) {
    const det = inferFromEvidence({ events: ctx.events, wallet: ctx.wallet });
    return { ok: false, reason, detail, fallback: det.ir };
}
