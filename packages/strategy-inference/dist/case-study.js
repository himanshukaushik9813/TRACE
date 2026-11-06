/**
 * Case study: one wallet's Uniswap V3 history as an evidence-backed report.
 *
 * Pure function over what the investigation stored: the reconstructed on-chain
 * events (NonfungiblePositionManager logs + ERC-721 transfers), positions()
 * metadata, the Strategy DNA and the strategy hypothesis. Every observation it
 * returns carries the exact events behind it (tx, block, log index, timestamp,
 * event kind, NFT id). Nothing is estimated or invented: what the data cannot
 * show is reported as a limitation instead.
 */
const KINDS = ["MINT", "INCREASE", "DECREASE", "COLLECT", "TRANSFER", "BURN"];
const ZERO = "0x0000000000000000000000000000000000000000";
const big = (v) => {
    if (typeof v === "bigint")
        return v;
    if (typeof v === "number")
        return Number.isFinite(v) ? BigInt(Math.trunc(v)) : 0n;
    if (typeof v === "string" && /^-?\d+$/.test(v.trim()))
        return BigInt(v.trim());
    return 0n;
};
const num = (v) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const addr = (v) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** Replay events in chain order (block, then log index) into CaseEvents with liquidity after each. */
function replay(events) {
    const sorted = [...events].sort((a, b) => num(a.block) - num(b.block) || num(a.logIndex) - num(b.logIndex));
    const liq = new Map();
    return sorted.map((e) => {
        const id = num(e.tokenId);
        const d = big(e.liquidityDelta);
        let l = liq.get(id) ?? 0n;
        if (e.kind === "MINT" || e.kind === "INCREASE")
            l += d < 0n ? -d : d;
        else if (e.kind === "DECREASE")
            l = l - (d < 0n ? -d : d) < 0n ? 0n : l - (d < 0n ? -d : d);
        else if (e.kind === "BURN")
            l = 0n;
        liq.set(id, l);
        return {
            tx: e.tx,
            block: num(e.block),
            logIndex: num(e.logIndex),
            timestamp: num(e.timestamp),
            kind: e.kind,
            tokenId: id,
            pool: addr(e.pool),
            liquidityDelta: big(e.liquidityDelta).toString(),
            liquidityAfter: l.toString(),
            amount0: big(e.amount0).toString(),
            amount1: big(e.amount1).toString(),
            fee0: big(e.fee0).toString(),
            fee1: big(e.fee1).toString(),
            from: addr(e.from),
            to: addr(e.to),
            tickLower: num(e.tickLower),
            tickUpper: num(e.tickUpper),
        };
    });
}
export function buildCaseStudy(input) {
    const all = replay(input.events);
    const metaById = new Map(input.meta.map((m) => [num(m.tokenId), m]));
    const tokenIds = [...new Set([...all.map((e) => e.tokenId), ...metaById.keys()])].sort((a, b) => a - b);
    const positions = tokenIds.map((id) => {
        const m = metaById.get(id);
        const evs = all.filter((e) => e.tokenId === id);
        const mint = evs.find((e) => e.kind === "MINT") ?? null;
        const burn = [...evs].reverse().find((e) => e.kind === "BURN") ?? null;
        const sum = (k, f) => evs.filter((e) => k.includes(e.kind)).reduce((a, e) => a + big(f(e)), 0n).toString();
        const last = evs[evs.length - 1];
        const closed = Boolean(burn) || Boolean(m?.burned) || (evs.length > 0 && last.liquidityAfter === "0" && evs.some((e) => e.kind === "DECREASE"));
        return {
            tokenId: id,
            pool: addr(m?.pool) ?? evs.find((e) => e.pool)?.pool ?? null,
            symbol0: m?.symbol0 ?? null,
            symbol1: m?.symbol1 ?? null,
            decimals0: m?.decimals0 ?? null,
            decimals1: m?.decimals1 ?? null,
            feeTier: m?.feeTier ?? null,
            tickLower: m?.tickLower ?? evs[0]?.tickLower ?? 0,
            tickUpper: m?.tickUpper ?? evs[0]?.tickUpper ?? 0,
            status: closed ? "closed" : "active",
            historyComplete: m ? Boolean(m.historyComplete) : Boolean(mint),
            opened: mint,
            closed: burn,
            events: evs,
            ownership: evs.filter((e) => e.kind === "MINT" || e.kind === "TRANSFER" || e.kind === "BURN").map((e) => ({ from: e.kind === "MINT" ? ZERO : e.from, to: e.kind === "BURN" ? ZERO : e.to, event: e })),
            feeCollections: evs.filter((e) => e.kind === "COLLECT" && (big(e.fee0) > 0n || big(e.fee1) > 0n)),
            totals: {
                deposited0: sum(["MINT", "INCREASE"], (e) => e.amount0),
                deposited1: sum(["MINT", "INCREASE"], (e) => e.amount1),
                withdrawn0: sum(["DECREASE"], (e) => e.amount0),
                withdrawn1: sum(["DECREASE"], (e) => e.amount1),
                fees0: sum(["COLLECT"], (e) => e.fee0),
                fees1: sum(["COLLECT"], (e) => e.fee1),
            },
            peakLiquidity: evs.reduce((a, e) => (big(e.liquidityAfter) > a ? big(e.liquidityAfter) : a), 0n).toString(),
        };
    });
    // Range re-sets: same rule as rangeResets() in @trace/uniswap-v3 — a new NFT in the same pool
    // with a different range, after the previous one was reduced or closed.
    const rangeChanges = [];
    const byPool = new Map();
    for (const p of positions)
        if (p.pool)
            byPool.set(p.pool.toLowerCase(), [...(byPool.get(p.pool.toLowerCase()) ?? []), p]);
    for (const [pool, list] of byPool) {
        const opened = list.filter((p) => p.opened).sort((a, b) => a.opened.block - b.opened.block || a.opened.logIndex - b.opened.logIndex);
        for (let i = 1; i < opened.length; i++) {
            const prev = opened[i - 1];
            const cur = opened[i];
            const reduction = prev.events.find((e) => (e.kind === "DECREASE" || e.kind === "BURN") && (e.block < cur.opened.block || (e.block === cur.opened.block && e.logIndex < cur.opened.logIndex)));
            if (!reduction)
                continue;
            if (prev.tickLower === cur.tickLower && prev.tickUpper === cur.tickUpper)
                continue;
            rangeChanges.push({
                pool,
                from: { tokenId: prev.tokenId, tickLower: prev.tickLower, tickUpper: prev.tickUpper },
                to: { tokenId: cur.tokenId, tickLower: cur.tickLower, tickUpper: cur.tickUpper },
                evidence: [reduction, cur.opened],
            });
        }
    }
    const liquidityTimeline = all.filter((e) => e.kind === "MINT" || e.kind === "INCREASE" || e.kind === "DECREASE" || e.kind === "BURN");
    const byKind = Object.fromEntries(KINDS.map((k) => [k, all.filter((e) => e.kind === k).length]));
    /* ---------------- observations (each with its source events) ---------------- */
    const obs = [];
    const add = (o) => {
        if (o.evidence.length || (o.missingRefs?.length ?? 0))
            obs.push({ source: "measured", missingRefs: [], ...o });
    };
    const opens = all.filter((e) => e.kind === "MINT");
    add({
        id: "opened",
        title: `Opened ${plural(opens.length, "position")}`,
        explanation: `The wallet minted ${plural(opens.length, "new Uniswap V3 position NFT")} in this window${positions.some((p) => !p.historyComplete) ? `; ${plural(positions.filter((p) => !p.historyComplete).length, "other position")} already existed before it` : ""}.`,
        evidence: opens,
    });
    const adds = all.filter((e) => e.kind === "INCREASE");
    add({ id: "added", title: `Added liquidity ${plural(adds.length, "time")}`, explanation: "Extra capital was deposited into existing positions (IncreaseLiquidity), separate from the initial mint.", evidence: adds });
    const removes = all.filter((e) => e.kind === "DECREASE");
    add({
        id: "removed",
        title: `Removed liquidity ${plural(removes.length, "time")}`,
        explanation: "Principal was taken out of positions (DecreaseLiquidity). The tokens are owed to the wallet until it collects them; that collection is not counted as fees.",
        evidence: removes,
    });
    const fees = positions.flatMap((p) => p.feeCollections).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    add({
        id: "fees",
        title: `Collected fees ${plural(fees.length, "time")}`,
        explanation: `Each Collect is split into principal (already counted at removal) and the fee portion.${input.fingerprints?.collectCadenceDays != null ? ` The median gap between collections was ${input.fingerprints.collectCadenceDays.toFixed(1)} days.` : ""}`,
        evidence: fees,
    });
    add({
        id: "range-changes",
        title: `Changed its price range ${plural(rangeChanges.length, "time")}`,
        explanation: "A range change is a new position in the same pool with a different range, opened after liquidity was removed from the previous one (V3 ranges are fixed per NFT).",
        evidence: rangeChanges.flatMap((r) => r.evidence),
    });
    const closes = all.filter((e) => e.kind === "BURN");
    add({ id: "closed", title: `Closed ${plural(closes.length, "position")}`, explanation: "The position NFT was burned after its liquidity and owed tokens were withdrawn.", evidence: closes });
    const transfers = all.filter((e) => e.kind === "TRANSFER");
    add({
        id: "transfers",
        title: `Moved a position NFT ${plural(transfers.length, "time")}`,
        explanation: "Ownership of the position NFT changed hands (ERC-721 Transfer). Liquidity is unaffected; the new owner controls it.",
        evidence: transfers,
    });
    const byTx = new Map();
    for (const e of all)
        byTx.set(e.tx.toLowerCase(), [...(byTx.get(e.tx.toLowerCase()) ?? []), e]);
    let ruleRefs = 0;
    let ruleRefsFound = 0;
    for (const [i, r] of (input.strategy?.rules ?? []).entries()) {
        const ev = [];
        const missing = [];
        for (const t of r.evidenceRefs) {
            ruleRefs++;
            const hit = byTx.get(t.toLowerCase());
            if (hit) {
                ruleRefsFound++;
                ev.push(...hit);
            }
            else
                missing.push(t);
        }
        add({
            id: `rule-${i}`,
            title: r.rule,
            explanation: `${r.evidence}. Another reading: ${r.alternative} Uncertainty: ${r.uncertainty}`,
            source: "strategy_rule",
            evidence: ev.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex),
            missingRefs: missing,
        });
    }
    /* ---------------- coverage + limitations ---------------- */
    const coverage = {
        events: all.length,
        eventsWithTimestamp: all.filter((e) => e.timestamp > 0).length,
        eventsWithReceipt: input.events.filter((e) => e.gasUsed && e.effectiveGasPrice).length,
        positions: positions.length,
        positionsWithFullHistory: positions.filter((p) => p.historyComplete).length,
        positionsWithMetadata: positions.filter((p) => metaById.has(p.tokenId)).length,
        observations: obs.length,
        observationsWithEvidence: obs.filter((o) => o.evidence.length > 0).length,
        ruleRefs,
        ruleRefsFound,
    };
    const limitations = [];
    if (!all.length)
        limitations.push("No Uniswap V3 position events were found for this wallet in the window, so there is nothing to reconstruct.");
    const partial = positions.filter((p) => !p.historyComplete);
    if (partial.length)
        limitations.push(`${plural(partial.length, "position")} (${partial.map((p) => `#${p.tokenId}`).join(", ")}) existed before the window; deposits, fees and changes before it are not included, so totals for them are partial.`);
    if (coverage.eventsWithTimestamp < coverage.events)
        limitations.push(`${coverage.events - coverage.eventsWithTimestamp} event(s) have no block timestamp; they are ordered by block but not placed in time.`);
    if (coverage.positionsWithMetadata < coverage.positions)
        limitations.push(`${coverage.positions - coverage.positionsWithMetadata} position(s) have no positions() metadata (pool, tokens, decimals); their amounts stay in base units.`);
    const noPool = positions.filter((p) => !p.pool).length;
    if (noPool)
        limitations.push(`${plural(noPool, "position")} could not be matched to a pool; it is excluded from range-change and price analysis.`);
    if (ruleRefs > ruleRefsFound)
        limitations.push(`${ruleRefs - ruleRefsFound} transaction(s) cited by the strategy are not among this investigation's events.`);
    if (input.fingerprints && input.fingerprints.timeInRangePct == null && all.length)
        limitations.push(input.fingerprints.timeInRangeSamples
            ? `Only ${input.fingerprints.timeInRangeSamples} real swap(s) happened in the pool(s) while positions were open, too few to report time in range.`
            : "No pool price data was available, so time-in-range and response to price moves are not measured.");
    for (const l of input.strategy?.limitations ?? [])
        if (!limitations.includes(l))
            limitations.push(l);
    return {
        wallet: input.wallet,
        chainId: input.chainId,
        window: input.window ?? null,
        overview: {
            positions: positions.length,
            active: positions.filter((p) => p.status === "active").length,
            closed: positions.filter((p) => p.status === "closed").length,
            pools: new Set(positions.map((p) => p.pool?.toLowerCase()).filter(Boolean)).size,
            events: all.length,
            byKind,
            firstEvent: all[0] ?? null,
            lastEvent: all[all.length - 1] ?? null,
        },
        positions,
        rangeChanges,
        liquidityTimeline,
        observations: obs,
        coverage,
        limitations,
    };
}
