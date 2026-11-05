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
  await expect(page.getByText("Testnet · Sepolia").first()).toBeVisible();
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
  await page.getByLabel("Observation window").selectOption("7");
  await page.getByRole("button", { name: /^Investigate/ }).click();
  await expect(page.getByText("No supported Uniswap V3 positions found")).toBeVisible({ timeout: 200_000 });
});

test("a completed investigation renders real data on every screen", async ({ page, request }) => {
  const recent = await (await request.get(`${API}/investigations/recent?limit=50`)).json();
  const done = recent.investigations.find((i: { status: string; counts: unknown }) => i.status === "done" && i.counts);
  test.skip(!done, "no completed investigation in the database yet");
  const id = done.id;

  await page.goto(`/positions?inv=${id}`);
  await expect(page.getByText(/reconstructed position/)).toBeVisible();
  await expect(page.getByText(/NFT #\d+/).first()).toBeVisible();

  await page.goto(`/strategy?inv=${id}`);
  await expect(page.getByRole("heading", { name: "Strategy DNA" })).toBeVisible();
  await expect(page.getByText("0G Private Computer inference (0G Router)")).toBeVisible();

  await page.goto(`/backtest?inv=${id}`);
  await expect(page.getByText(/Backtest could not be completed|Insufficient real data|Historical replay on real swaps/)).toBeVisible();

  await page.goto(`/reports?inv=${id}`);
  await expect(page.getByRole("heading", { name: "Integration status" })).toBeVisible();
  await expect(page.getByText("VERIFIED TESTNET").first()).toBeVisible();

  await page.goto(`/execute?inv=${id}`);
  await page.getByRole("button", { name: /on-chain (compatibility )?checks/ }).click();
  await expect(page.getByText("Aqua registry deployed on Sepolia")).toBeVisible({ timeout: 120_000 });
});
