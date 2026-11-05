/**
 * Startup configuration — read once from the environment, validated, and
 * reported without ever printing a secret value.
 *
 * Load with:  node --env-file=.env.local server/dist/index.js
 */
import { SEPOLIA_CHAIN_ID } from "@trace/chain-config";
const env = (k) => {
    const v = process.env[k];
    return v && v.trim() !== "" ? v.trim() : undefined;
};
export function loadConfig() {
    const fatal = [];
    const chainId = Number(env("TRACE_CHAIN_ID") ?? SEPOLIA_CHAIN_ID);
    if (chainId !== SEPOLIA_CHAIN_ID)
        fatal.push(`TRACE_CHAIN_ID=${chainId} is not supported — TRACE runs on Ethereum Sepolia (${SEPOLIA_CHAIN_ID}) only`);
    const rpc = env("SEPOLIA_RPC_URL");
    if (!rpc)
        fatal.push("SEPOLIA_RPC_URL is required (an Infura/Alchemy/QuickNode Sepolia endpoint)");
    else if (/mainnet|eth-mainnet|\/\/mainnet\./i.test(rpc))
        fatal.push("SEPOLIA_RPC_URL looks like a MAINNET endpoint — refusing to start");
    const db = env("DATABASE_URL");
    if (!db)
        fatal.push("DATABASE_URL is required (Postgres / Supabase)");
    const trust = env("ZERO_G_TRUST_MODE");
    if (trust && !["standard", "verified", "private"].includes(trust))
        fatal.push("ZERO_G_TRUST_MODE must be standard | verified | private");
    const config = {
        chainId,
        port: Number(env("PORT") ?? 4000),
        sepoliaRpcUrl: rpc ?? "",
        sepoliaFallbackRpcUrls: (env("SEPOLIA_RPC_FALLBACK_URLS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        databaseUrl: db ?? "",
        databaseSsl: env("DATABASE_SSL") !== "disable",
        redisUrl: env("REDIS_URL") ?? null,
        zeroG: {
            routerUrl: env("ZERO_G_ROUTER_URL"),
            apiKey: env("ZERO_G_API_KEY"),
            model: env("ZERO_G_MODEL") ?? "glm-4.7",
            trustMode: trust,
            verifyTee: env("ZERO_G_VERIFY_TEE") !== "false",
        },
        storage: { rpcUrl: env("OG_STORAGE_RPC_URL"), indexerUrl: env("OG_STORAGE_INDEXER_URL"), privateKey: env("OG_STORAGE_PRIVATE_KEY") },
        world: {
            appId: env("WORLD_APP_ID"),
            rpId: env("WORLD_RP_ID"),
            signingKey: env("WORLD_RP_SIGNING_KEY"),
            action: env("WORLD_ACTION") ?? "trace-authorize-execution",
            environment: env("WORLD_ENVIRONMENT") === "production" ? "production" : "staging",
        },
        corsOrigins: (env("CORS_ORIGINS") ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim()),
    };
    const checks = [
        { name: "SEPOLIA_RPC_URL", required: true, set: Boolean(rpc) },
        { name: "DATABASE_URL", required: true, set: Boolean(db) },
        { name: "REDIS_URL", required: false, set: Boolean(config.redisUrl), note: "without it the queue runs in-process (no durability)" },
        { name: "ZERO_G_ROUTER_URL / ZERO_G_API_KEY", required: false, set: Boolean(config.zeroG.routerUrl && config.zeroG.apiKey), note: "0G inference" },
        { name: "OG_STORAGE_PRIVATE_KEY", required: false, set: Boolean(config.storage.privateKey), note: "0G Storage uploads (funded Galileo burner key)" },
        { name: "WORLD_RP_ID / WORLD_RP_SIGNING_KEY", required: false, set: Boolean(config.world.rpId && config.world.signingKey), note: "World ID staging layer" },
    ];
    return { config, checks, fatal };
}
export function printConfigReport(checks, fatal) {
    console.log("[trace] configuration (values never printed):");
    for (const c of checks) {
        console.log(`  ${c.set ? "✓" : c.required ? "✗" : "–"} ${c.name}${c.set ? "" : c.required ? "  (REQUIRED)" : `  (optional${c.note ? `: ${c.note}` : ""})`}`);
    }
    for (const f of fatal)
        console.error(`[trace] config error: ${f}`);
}
