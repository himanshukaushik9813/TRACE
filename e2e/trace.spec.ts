import { test, expect, type Page } from "@playwright/test";

const API = process.env.TRACE_API_URL ?? "http://localhost:4000";

/**
 * Test-only EIP-1193 provider injected into the page (no real keys). It lets
 * the E2E exercise connect / wrong-network / switch handling in the UI.
 */
async function injectWallet(page: Page, address: string, chainIdHex: string) {
  await page.addInitScript(
    ([addr, chain]) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      let chainId = chain;
      const emit = (ev: string, v: unknown) => (listeners[ev] ?? []).forEach((f) => f(v));
      // Test hook: simulate the user changing network inside their wallet.
      (window as unknown as { __walletSwitch: (c: string) => void }).__walletSwitch = (c: string) => {
        chainId = c;
        emit("chainChanged", c);
      };
      (window as unknown as { ethereum: unknown }).ethereum = {
        isMetaMask: true,
        request: async ({ method, params }: { method: string; params?: { chainId: string }[] }) => {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [addr];
            case "eth_chainId":
              return chainId;
            case "net_version":
              return String(parseInt(chainId, 16));
            case "wallet_switchEthereumChain":
              chainId = params![0].chainId;
              emit("chainChanged", chainId);
              return null;
            case "wallet_requestPermissions":
            case "wallet_getPermissions":
              return [{ parentCapability: "eth_accounts" }];
            default:
              throw Object.assign(new Error(`unsupported in test provider: ${method}`), { code: 4200 });
          }
        },
        on: (ev: string, f: (...a: unknown[]) => void) => ((listeners[ev] ??= []).push(f)),
        removeListener: (ev: string, f: (...a: unknown[]) => void) => (listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f)),
      };
    },
    [address, chainIdHex],
  );
}

test("home shows the Sepolia testnet indicator and no demo or mainnet labels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sepolia testnet").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect wallet/ })).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/demo data/i);
  expect(body).not.toMatch(/Ethereum Mainnet/i);
});

test("wrong network after connecting is detected and the user switches to Sepolia explicitly", async ({ page }) => {
  const addr = "0x1111111111111111111111111111111111111111";
  await injectWallet(page, addr, "0x1");
  await page.goto("/");
  await page.getByRole("button", { name: /Connect wallet/ }).click();
  // Connect requests accounts only; the wallet is still on mainnet → signing blocked + banner.
  await expect(page.getByText("0x1111…1111").first()).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "TRACE only runs on" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(page.getByText("TRACE only runs on")).toHaveCount(0);
  // Changing network inside the wallet later is detected again.
  await page.evaluate(() => (window as unknown as { __walletSwitch: (c: string) => void }).__walletSwitch("0x1"));
  await expect(page.getByRole("alert").filter({ hasText: "TRACE only runs on" })).toBeVisible();
});

test("a wallet with no Uniswap positions gets a genuine empty state", async ({ page }) => {
  const empty = `0x${Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
  await page.goto("/");
  await page.getByLabel("Wallet address").fill(empty);
  await page.getByLabel("How far back to look").selectOption("7");
  await page.getByRole("button", { name: /^Investigate/ }).click();
  await expect(page.getByText("No supported Uniswap V3 positions found")).toBeVisible({ timeout: 200_000 });
});

test("a completed investigation renders real data on every screen", async ({ page, request }) => {
  const recent = await (await request.get(`${API}/investigations/recent?limit=50`)).json();
  const done = recent.investigations.find((i: { status: string; counts: unknown }) => i.status === "done" && i.counts);
  test.skip(!done, "no completed investigation in the database yet");
  const id = done.id;

  await page.goto(`/positions?inv=${id}`);
  await expect(page.getByRole("heading", { level: 1, name: /liquidity positions?/ })).toBeVisible();
  // The 3D terrain (or its 2D fallback when the browser has no WebGL) is the hero.
  await expect(page.getByRole("heading", { name: "Liquidity over price and time" })).toBeVisible();
  await expect(page.locator("figure canvas, figure svg").first()).toBeVisible({ timeout: 20_000 });
  // Cards are plain; NFT ids live behind "View details".
  await page.getByRole("link", { name: /View details of/ }).first().click();
  await expect(page.getByText("What went into this position")).toBeVisible();
  await page.getByText("Technical details").click();
  await expect(page.getByText(/#\d+/).first()).toBeVisible();
  await expect(page.getByText("Lifecycle events")).toBeVisible();

  await page.goto(`/strategy?inv=${id}`);
  await expect(page.getByText("A hypothesis, not confirmed intent")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Supporting on-chain evidence" })).toBeVisible();
  await page.getByText("Technical details").first().click();
  await expect(page.getByText(/0G Private Computer (was unavailable|proposed this hypothesis)/)).toBeVisible();
  await expect(page.getByText(/Strategy DNA: eight measurements/)).toBeVisible();

  // Old /saved links land on Strategy → Versions; with two or more versions, Compare shows a side-by-side.
  await page.goto(`/saved?inv=${id}`);
  await expect(page).toHaveURL(/\/strategy\?tab=versions/);
  await expect(page.getByText(/Pick two to see what changed|No strategy versions/)).toBeVisible();
  if ((await page.getByRole("checkbox").count()) >= 2) await expect(page.getByRole("heading", { name: "Compare versions" })).toBeVisible();

  await page.goto(`/backtest?inv=${id}`);
  await expect(page.getByRole("heading", { name: "How did this strategy perform?" })).toBeVisible();
  await expect(page.getByText(/Backtest could not be completed|Insufficient real data|TRACE replayed \d+ real swaps/)).toBeVisible();
  if (await page.getByRole("button", { name: "Run simulation" }).count()) {
    // What If runs on the real API and is always labelled a simulation.
    await page.getByRole("slider").focus();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("Your settings", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/^Simulation, not observed\. Both columns replay/)).toBeVisible();
  }

  await page.goto(`/reports?inv=${id}`);
  await expect(page.getByRole("heading", { name: "What TRACE found" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download report (JSON)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Integration status" })).toBeVisible();
  await expect(page.getByText("Working on Sepolia").first()).toBeVisible(); // plain label; technical label in the tooltip
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download report (JSON)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^trace-report-0x[0-9a-fA-F]{8}-[0-9a-f]{8}\.json$/);

  // Execute: the live compatibility check (real Sepolia reads), in plain words.
  await page.goto(`/execute?inv=${id}`);
  await page.getByRole("button", { name: /Run the check|Check again/ }).click();
  await page.getByText("What was checked").click({ timeout: 120_000 });
  await expect(page.getByText("The Aqua registry exists on Sepolia")).toBeVisible({ timeout: 120_000 });
});

/**
 * The Investigate workflow ticks a step only from real evidence. A real
 * completed investigation (no plan signed yet) must show Analyze + Understand
 * complete and Verify/Execute open. To exercise the completion moment without
 * spending testnet funds, the second half fulfils /full with that same real
 * payload plus a test-only validated authorization and confirmed ship tx.
 */
test("workflow ticks only completed steps, and all four tick together after a confirmed ship", async ({ page, request }) => {
  const recent = await (await request.get(`${API}/investigations/recent?limit=30`)).json();
  let id: string | null = null;
  let real: Record<string, unknown> | null = null;
  for (const r of recent.investigations.filter((x: { status: string }) => x.status === "done")) {
    const f = await (await request.get(`${API}/investigations/${r.id}/full`)).json();
    const primary = f.strategies.find((s: { id: string }) => s.id === f.primaryStrategyId);
    if (primary && primary.family !== "inconclusive" && f.plans.length === 0) {
      id = r.id;
      real = f;
      break;
    }
  }
  test.skip(!id, "needs a completed investigation with an executable strategy");

  await page.goto(`/?inv=${id}`);
  const flow = page.getByRole("list", { name: /Investigation workflow/ });
  await expect(flow).toHaveAttribute("aria-label", /2 of 4 steps complete/, { timeout: 30_000 });
  await expect(flow.getByText("Analyze, complete")).toBeAttached();
  await expect(flow.getByText("Understand, complete")).toBeAttached();
  await expect(page.getByText("All four steps complete")).toHaveCount(0);

  const maker = "0x1111111111111111111111111111111111111111";
  const planId = "00000000-0000-4000-8000-000000000001";
  const now = new Date().toISOString();
  await page.route(`**/investigations/${id}/full`, (route) =>
    route.fulfill({
      json: {
        ...real,
        plans: [{ id: planId, maker, planHash: "0xplan", createdAt: now, plan: { maker, params: { priceLow: 0, priceHigh: 0 }, steps: [], notCompiled: [] } }],
        authorizations: [{ id: "a1", planId, wallet: maker, action: "aqua:ship", validated: true, worldStatus: "not_configured", createdAt: now }],
        transactions: [{ id: "t1", op: "ship", tx_hash: `0x${"ab".repeat(32)}`, status: "success", plan_id: planId, created_at: now }],
      },
    }),
  );
  await page.goto(`/?inv=${id}`); // a link to the investigation (a browser reload starts fresh)
  await expect(flow).toHaveAttribute("aria-label", /4 of 4 steps complete/, { timeout: 30_000 });
  await expect(page.getByText("All four steps complete")).toBeVisible();
  await expect(page.getByRole("link", { name: /View ship transaction/ })).toBeVisible();
});

/**
 * The guided 8-step Execute flow, end to end in the browser. The API is mocked
 * statefully (no plan, authorization or transaction is written to the real
 * database): the mock records exactly what the real server would and serves it
 * back through /full, because every step is driven only by server state. The
 * test wallet signs the EIP-712 challenge, rejects the first approve (the flow
 * stops with a clear message and resumes from that step), then approves and
 * ships. Investigate's workflow then shows all four steps complete, and a
 * browser refresh of Investigate starts fresh without sending anything again.
 */
test("guided Execute: review, sign, a rejected approve resumes, ship; Investigate ticks all four", async ({ page, request }) => {
  const recent = await (await request.get(`${API}/investigations/recent?limit=30`)).json();
  let id: string | null = null;
  let real: Record<string, unknown> | null = null;
  for (const r of recent.investigations.filter((x: { status: string }) => x.status === "done")) {
    const f = await (await request.get(`${API}/investigations/${r.id}/full`)).json();
    const primary = f.strategies.find((s: { id: string }) => s.id === f.primaryStrategyId);
    if (primary && primary.family !== "inconclusive" && f.plans.length === 0 && f.compatibility?.report?.verdict !== "INCOMPATIBLE" && f.positions.length) {
      id = r.id;
      real = f;
      break;
    }
  }
  test.skip(!id, "needs a completed investigation with an executable strategy");

  const maker = "0x2222222222222222222222222222222222222222";
  await injectWallet(page, maker, "0xaa36a7");
  await page.addInitScript(() => {
    const w = window as unknown as { ethereum: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }; __sends: number };
    const base = w.ethereum.request;
    w.__sends = 0;
    w.ethereum.request = async (a) => {
      if (a.method === "eth_signTypedData_v4") return `0x${"11".repeat(65)}`;
      if (a.method === "eth_estimateGas") return "0x5208";
      if (a.method === "eth_sendTransaction") {
        w.__sends += 1;
        if (w.__sends === 1) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        return `0x${w.__sends.toString(16).padStart(64, "0")}`;
      }
      return base(a);
    };
  });

  // Server state, as the real API would hold it.
  const token = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
  const registry = "0xe8026bf31e58b738647319362581ab11be92139b";
  const now = () => new Date().toISOString();
  const plans: unknown[] = [];
  const auths: unknown[] = [];
  const txs: { id: string; op: string; tx_hash: string; status: string; to_addr: string; plan_id: string; created_at: string; block?: string; confirmations?: number; matches_plan?: boolean }[] = [];
  const compat = { strategyId: "s", verdict: "PARTIAL", rules: [{ rule: "Collects fees", category: "fee", status: "supported" }, { rule: "Risk limit", category: "risk", status: "unsupported", gap: "No on-chain risk limits in Aqua." }], capabilities: [], checks: [], unsupportedNotes: [], assessedAt: 0 };
  const plan = {
    maker,
    planHash: "0xplan",
    strategyHash: "0xstrategy",
    order: "0x00",
    params: { priceLow: 1, priceHigh: 2, feeBps: 30 },
    tokens: [{ address: token, symbol: "WETH", decimals: 18, amount: "10000000000000000" }],
    steps: [
      { op: "approve", description: "approve", to: token, data: "0x", value: "0" },
      { op: "ship", description: "ship", to: registry, data: "0x", value: "0" },
    ],
    notCompiled: [],
  };
  await page.route(`**/investigations/${id}/full`, (r) =>
    r.fulfill({ json: { ...real, compatibility: { id: "c", maker: null, verdict: "PARTIAL", report: compat, createdAt: now() }, plans: [...plans].reverse(), authorizations: [...auths].reverse(), transactions: [...txs].reverse() } }),
  );
  await page.route("**/strategies/*/compatibility", (r) => r.fulfill({ json: { reportId: "r", compatibility: compat } }));
  await page.route("**/strategies/*/plan", (r) => {
    plans.push({ id: "p1", maker, planHash: "0xplan", createdAt: now(), plan });
    return r.fulfill({ json: { planId: "p1", compatibility: compat, simulation: { [`approve:${token}`]: { ok: true }, [`ship:${registry}`]: { ok: true } }, plan } });
  });
  await page.route("**/plans/*/challenge", (r) =>
    r.fulfill({ json: { typedData: { domain: { name: "TRACE", version: "1", chainId: 11155111 }, types: { Authorization: [{ name: "wallet", type: "address" }, { name: "chainId", type: "uint256" }, { name: "expiresAt", type: "uint256" }] }, primaryType: "Authorization", message: { wallet: maker, chainId: "11155111", expiresAt: "9999999999" } }, claims: {} } }),
  );
  await page.route("**/authorizations", (r) => {
    auths.push({ id: "a1", planId: "p1", wallet: maker, action: "aqua:ship", validated: true, worldStatus: "not_configured", expiresAt: new Date(Date.now() + 600_000).toISOString(), live: true, createdAt: now() });
    return r.fulfill({ json: { authorizationId: "a1", validated: true, signer: maker, verification: { notes: [] } } });
  });
  await page.route("**/transactions", (r) => {
    const b = r.request().postDataJSON() as { op: string; txHash: string };
    txs.push({ id: `t${txs.length}`, op: b.op, tx_hash: b.txHash, status: "submitted", to_addr: b.op === "approve" ? token : registry, plan_id: "p1", created_at: now() });
    return r.fulfill({ status: 202, json: { recorded: true } });
  });
  await page.route("**/transactions/0x*", (r) => {
    const t = txs.find((x) => r.request().url().endsWith(x.tx_hash));
    if (t) Object.assign(t, { status: "success", block: "12345678", confirmations: 3, matches_plan: true }); // the receipt arrives
    return t ? r.fulfill({ json: t }) : r.fulfill({ status: 404, json: { error: "not found" } });
  });

  await page.goto(`/execute?inv=${id}`);
  const steps = page.getByRole("list", { name: /Execution steps/ });
  await expect(steps).toHaveAttribute("aria-label", /3 of 8 complete/, { timeout: 30_000 });
  await expect(page.getByText("does not run on Aqua.")).toBeVisible(); // step 3, in plain words
  await page.getByRole("button", { name: /Connect wallet/ }).click();

  // Step 4: amounts → the transactions are prepared and dry-run.
  await page.getByLabel(/to commit/).last().fill("0.01");
  await page.getByRole("button", { name: "Prepare the transactions" }).click();
  // Step 5: plain review, then the explicit checkbox.
  await expect(page.getByText(/allow Aqua to use exactly 0\.01 WETH/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign authorization" })).toHaveCount(0); // step 6 opens only after the review
  await page.getByLabel("I have reviewed these transactions").check();
  await expect(steps).toHaveAttribute("aria-label", /5 of 8 complete/);

  // Step 6: one signature, verified by the (mocked) server.
  await page.getByRole("button", { name: "Sign authorization" }).click();
  await expect(steps).toHaveAttribute("aria-label", /6 of 8 complete/, { timeout: 30_000 });

  // Step 7: the first approve is rejected in the wallet → clear message, resumable.
  await page.getByRole("button", { name: "Approve and ship" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "You rejected the request in your wallet" })).toBeVisible({ timeout: 30_000 });
  await expect(steps).toHaveAttribute("aria-label", /6 of 8 complete/);
  await page.getByRole("button", { name: "Retry execution" }).click();

  // Step 8: receipt.
  await expect(steps).toHaveAttribute("aria-label", /8 of 8 complete/, { timeout: 60_000 });
  await expect(page.getByText("Matches the plan you authorized")).toBeVisible();
  expect(txs.map((t) => t.op)).toEqual(["approve", "ship"]); // nothing sent twice

  // Investigate reads the same server state: all four workflow steps tick.
  await page.goto(`/?inv=${id}`);
  const flow = page.getByRole("list", { name: /Investigation workflow/ });
  await expect(flow).toHaveAttribute("aria-label", /4 of 4 steps complete/, { timeout: 30_000 });
  await expect(page.getByText("All four steps complete")).toBeVisible();
  await expect(page.getByText("This strategy is live on 1inch Aqua")).toBeVisible();

  // A browser refresh starts the Investigate page from the beginning: no
  // investigation loaded, every step back to waiting, nothing sent again.
  await page.reload();
  await expect(page).not.toHaveURL(/inv=/);
  await expect(flow).toHaveAttribute("aria-label", /0 of 4 steps complete/, { timeout: 30_000 });
  await expect(page.getByText("All four steps complete")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("trace:lastInvestigation"))).toBeNull();
  expect(txs.map((t) => t.op)).toEqual(["approve", "ship"]);
});

test("first-visit welcome shows once: Skip hides it for the session, Don't show again for good, Replay brings it back", async ({ page }) => {
  await page.goto("/");
  const welcome = page.getByRole("region", { name: /See how any wallet provides liquidity/ });
  await expect(welcome).toBeVisible();
  await expect(welcome.getByText("Analyze")).toBeVisible();

  // Skip: gone for this session, even after a reload.
  await welcome.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Understand how a wallet manages liquidity." })).toBeVisible();
  await expect(welcome).toHaveCount(0);

  // A new session (fresh sessionStorage) shows it again until "Don't show again".
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Don't show again" }).click();
  await expect(welcome).toHaveCount(0);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Understand how a wallet manages liquidity." })).toBeVisible();
  await expect(welcome).toHaveCount(0);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("trace:onboarding:v1"))) ?? "{}").hidden).toBe(true);

  // "Replay the tour" in the sidebar starts over from the welcome card.
  await page.getByRole("button", { name: "Replay the tour" }).first().click();
  await expect(welcome).toBeVisible();
  await expect(page.getByText("Getting started").first()).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Getting started progress" }).first()).toHaveAttribute("aria-valuenow", "0");
});

test("case study: real investigation → timeline event detail and Evidence Explorer rows link to the explorer", async ({ page, request }) => {
  const recent = await (await request.get(`${API}/investigations/recent?limit=50`)).json();
  const done = recent.investigations.find((i: { status: string; counts: { positions?: number } | null }) => i.status === "done" && (i.counts?.positions ?? 0) > 0);
  test.skip(!done, "no completed investigation with positions in the database yet");
  const cs = await (await request.get(`${API}/investigations/${done.id}/case-study`)).json();
  await page.goto(`/case-study?inv=${done.id}`);
  await expect(page.getByRole("heading", { name: "Evidence Explorer" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`${cs.overview.positions}`, { exact: true }).first()).toBeAttached();
  // Select the first real event on the timeline: its detail shows the source event and links.
  const first = cs.positions.flatMap((p: { events: { kind: string; tokenId: number; block: number }[] }) => p.events)[0];
  await page.getByRole("button", { name: new RegExp(`NFT #${first.tokenId}, block ${first.block.toLocaleString("en-US")}`) }).first().click();
  await expect(page.getByText(`${first.kind} (log index`).first()).toBeVisible();
  // Every evidence row links its transaction to Sepolia Etherscan.
  const txLinks = page.locator('table a[href*="sepolia.etherscan.io/tx/0x"]');
  expect(await txLinks.count()).toBeGreaterThan(0);
});
