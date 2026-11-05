/**
 * 0G Private Computer inference via the 0G Router (OpenAI-compatible) — with
 * a hard deterministic validation gate.
 *
 * Product rule: the model is NOT the source of blockchain truth. It receives
 * a structured evidence pack (fingerprints + citable tx hashes + position
 * facts) and returns a structured hypothesis. The gate then:
 *   1. parses + schema-checks the proposal,
 *   2. audits every rule's evidenceRefs against the citable set — refs not
 *      in the set are stripped; a rule left with no valid ref is rejected,
 *   3. caps each confidence at the deterministic support level,
 *   4. validates the final IR (validateStrategyIR) and stamps its content id.
 *
 * There is NO demo transport. If the router is not configured or the call
 * fails, the result is `ok:false` with the real error and the run metadata;
 * the caller shows the error and (separately labelled) the evidence-only
 * deterministic analysis — never a fabricated AI answer.
 */
import { contentHash, finalizeStrategyIR, validateStrategyIR } from "@trace/strategy-ir";
import { CONFIDENCE_NOTE, scoreFamilies } from "./infer.js";
export function buildEvidencePack(events, fp, window, positions = []) {
    return {
        fingerprints: fp,
        citableEvents: [...new Set(events.map((e) => e.tx))],
        events: events.slice(0, 200).map((e) => ({ kind: e.kind, tx: e.tx, block: e.block, tokenId: e.tokenId, pool: e.pool })),
        positions: positions.slice(0, 50),
        window,
    };
}
const SYSTEM_PROMPT = [
    "You are TRACE's strategy-inference model running behind the 0G Router.",
    "Infer the liquidity-provision strategy of an Ethereum Sepolia wallet from a DETERMINISTIC evidence pack of its Uniswap V3 activity.",
    "Return ONLY a JSON object with this exact shape:",
    '{"family": one of ["passive_concentrated","passive_full_range","periodic_range_adjustment","active_range_management","capital_redeployment","inconclusive"],',
    ' "confidence": number 0..1,',
    ' "rules": [{"category": "entry"|"adjustment"|"exit"|"risk"|"fee", "rule": string, "evidence": string, "evidenceRefs": [tx hashes], "confidence": number 0..1, "alternative": string, "uncertainty": string, "mapsTo": "trigger"|"schedule"|"allocation"|"limit"|"action"}],',
    ' "alternatives": [{"label": string, "family": string, "score": 0..100, "why": string}],',
    ' "limitations": [string]}',
    "Hard constraints (enforced by a deterministic validator; violations are rejected):",
    "- Every rule MUST cite one or more tx hashes copied exactly from citableEvents.",
    "- Do not invent events, addresses, prices or numbers that are not in the pack.",
    '- If the evidence is too thin, return family "inconclusive" with an empty rules array.',
    "- Confidence is fit-to-evidence, not the probability the strategy is correct.",
].join("\n");
function emptyRun(cfg, startedAt) {
    return {
        status: "failed",
        requestId: null,
        model: cfg.model ?? null,
        providerAddress: null,
        teeVerified: null,
        trustMode: cfg.trustMode ?? null,
        httpStatus: null,
        errorCode: null,
        error: null,
        usage: null,
        responseHash: null,
        latencyMs: 0,
        startedAt,
        rulesRejected: 0,
    };
}
/** Real router call. Throws nothing: every failure becomes ok:false with the real error. */
export async function runZeroGInference(opts) {
    const cfg = opts.cfg ?? {};
    const startedAt = Math.floor(Date.now() / 1000);
    const t0 = Date.now();
    const run = emptyRun(cfg, startedAt);
    if (!cfg.routerUrl || !cfg.apiKey || !cfg.model) {
        run.status = "not_configured";
        run.error = "0G Router not configured (ZERO_G_ROUTER_URL, ZERO_G_API_KEY, ZERO_G_MODEL)";
        return { ok: false, reason: "not_configured", detail: run.error, run };
    }
    const userContent = JSON.stringify({ wallet: opts.wallet, ...opts.pack });
    const send = async (jsonMode) => {
        const headers = { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` };
        if (cfg.trustMode)
            headers["X-0G-Provider-Trust-Mode"] = cfg.trustMode;
        return fetch(`${cfg.routerUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: cfg.model,
                temperature: 0,
                max_tokens: 2_000,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userContent },
                ],
                ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
                ...(cfg.verifyTee ? { verify_tee: true } : {}),
            }),
            signal: AbortSignal.timeout(cfg.requestTimeoutMs ?? 90_000),
        });
    };
    let body;
    try {
        let res = await send(true);
        let json = (await res.json().catch(() => ({})));
        const err = json.error;
        if (!res.ok && err?.code === "model_not_capable") {
            res = await send(false); // model has no JSON mode: ask for JSON in-prompt only
            json = (await res.json().catch(() => ({})));
        }
        run.httpStatus = res.status;
        run.latencyMs = Date.now() - t0;
        const trace = (json.x_0g_trace ?? {});
        run.requestId = trace.request_id ?? json.request_id ?? json.id ?? null;
        run.providerAddress = trace.provider ?? null;
        run.teeVerified = typeof trace.tee_verified === "boolean" ? trace.tee_verified : null;
        if (!res.ok || json.error) {
            const e = (json.error ?? {});
            run.errorCode = e.code ?? `http_${res.status}`;
            run.error = e.message ?? `0G Router returned HTTP ${res.status}`;
            return { ok: false, reason: "provider_error", detail: `${run.errorCode}: ${run.error}`, run };
        }
        body = json;
    }
    catch (err) {
        run.latencyMs = Date.now() - t0;
        run.errorCode = "transport_error";
        run.error = String(err.message ?? err);
        return { ok: false, reason: "transport_error", detail: run.error, run };
    }
    run.model = body.model ?? cfg.model ?? null;
    const usage = (body.usage ?? {});
    const billing = (body.x_0g_trace?.billing ?? {});
    run.usage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalCostNeuron: billing.total_cost != null ? String(billing.total_cost) : undefined };
    if (cfg.verifyTee && run.teeVerified === false) {
        run.status = "rejected";
        run.error = "0G Router reported tee_verified=false — response treated as untrusted";
        return { ok: false, reason: "provider_error", detail: run.error, run };
    }
    const content = (body.choices?.[0]?.message?.content ?? "").trim();
    run.responseHash = contentHash(content).digest.slice(0, 32);
    let raw;
    try {
        raw = JSON.parse(content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    }
    catch {
        run.status = "rejected";
        run.error = "model output was not valid JSON";
        return { ok: false, reason: "unparseable", detail: run.error, run };
    }
    const gated = gateProposal(raw, opts.pack, { wallet: opts.wallet, baseline: opts.baseline, run });
    if (!gated.ok) {
        run.status = "rejected";
        run.error = gated.detail;
        return { ok: false, reason: gated.reason, detail: gated.detail, run };
    }
    run.status = "succeeded";
    return { ok: true, ir: gated.ir, run };
}
/** THE GATE: a validated, evidence-anchored StrategyIR, or a typed rejection. */
export function gateProposal(raw, pack, ctx) {
    const citable = new Set(pack.citableEvents.map((t) => t.toLowerCase()));
    const support = new Map(scoreFamilies(pack.fingerprints).map((f) => [f.family, f.score]));
    const family = String(raw.family ?? "inconclusive");
    let rejected = 0;
    const rules = [];
    for (const r of raw.rules ?? []) {
        const refs = (r.evidenceRefs ?? []).filter((t) => typeof t === "string" && citable.has(t.toLowerCase()));
        if (refs.length === 0) {
            rejected++;
            continue; // a rule that cites nothing real is a guess — dropped
        }
        const baselineRule = ctx.baseline.rules.find((b) => b.category === r.category);
        const cap = baselineRule ? Math.max(baselineRule.confidence, 0.5) : 0.5;
        rules.push({
            category: (r.category ?? "adjustment"),
            rule: String(r.rule ?? ""),
            evidence: String(r.evidence ?? ""),
            evidenceRefs: refs,
            confidence: Math.min(Number(r.confidence ?? 0), cap),
            alternative: String(r.alternative ?? ""),
            uncertainty: String(r.uncertainty ?? ""),
            mapsTo: r.mapsTo,
        });
    }
    ctx.run.rulesRejected = rejected;
    if (family !== "inconclusive" && rules.length === 0) {
        return { ok: false, reason: "no_citable_evidence", detail: `all ${rejected} proposed rule(s) cited evidence outside the deterministic set` };
    }
    const familySupport = support.get(family) ?? 0;
    const candidate = {
        version: "2",
        id: "pending",
        parentId: ctx.baseline.id,
        wallet: ctx.wallet,
        chainId: 11155111,
        sourceProtocol: "uniswap-v3",
        evidencePeriod: pack.window,
        family,
        // Never above what the deterministic layer supports for that family.
        confidence: Number(Math.min(Number(raw.confidence ?? 0), familySupport + 0.15, 1).toFixed(3)),
        confidenceNote: CONFIDENCE_NOTE,
        rules,
        alternatives: Array.isArray(raw.alternatives) ? raw.alternatives.slice(0, 6) : ctx.baseline.alternatives,
        evidenceRefs: [...new Set(rules.flatMap((r) => r.evidenceRefs))],
        limitations: [
            ...(Array.isArray(raw.limitations) ? raw.limitations.map(String).slice(0, 8) : []),
            ...(rejected ? [`${rejected} proposed rule(s) cited transactions outside the evidence set and were rejected`] : []),
            ...(ctx.run.teeVerified === true ? [] : ["0G TEE attestation not verified for this response"]),
        ],
        source: {
            model: ctx.run.model ?? "unknown",
            provider: "0G_ROUTER",
            requestRef: ctx.run.requestId ?? undefined,
            schemaValid: true,
            attested: ctx.run.teeVerified === true,
            ts: Math.floor(Date.now() / 1000),
        },
    };
    if (family === "inconclusive" && candidate.evidenceRefs.length === 0)
        candidate.evidenceRefs = pack.citableEvents.slice(0, 12);
    const v = validateStrategyIR(candidate);
    if (!v.ok)
        return { ok: false, reason: "schema_invalid", detail: v.issues.map((i) => `${i.path}: ${i.message}`).join("; ") };
    const ir = finalizeStrategyIR(candidate);
    const v2 = validateStrategyIR(ir);
    if (!v2.ok)
        return { ok: false, reason: "schema_invalid", detail: v2.issues.map((i) => `${i.path}: ${i.message}`).join("; ") };
    return { ok: true, ir };
}
