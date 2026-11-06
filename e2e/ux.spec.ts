import { test, expect, type Page } from "@playwright/test";

/**
 * Beginner-facing UX checks, run on desktop (1440px) and mobile (390px touch).
 * Everything reads real data from the running API; nothing is mocked.
 */

const API = process.env.TRACE_API_URL ?? "http://localhost:4000";
const NAV = ["Investigate", "Positions", "Strategy", "Backtest", "Execute", "Reports", "Activity"];

async function openNav(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  return page.locator("nav:visible");
}

async function doneInvestigation(request: import("@playwright/test").APIRequestContext): Promise<string | null> {
  const recent = await (await request.get(`${API}/investigations/recent?limit=50`)).json();
  return recent.investigations.find((i: { status: string; counts: unknown }) => i.status === "done" && i.counts)?.id ?? null;
}

/** Elements that stick out past the viewport and are not inside a scroll/clip container. */
const overflowing = (page: Page) =>
  page.evaluate(() => {
    const W = innerWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= W + 1) continue;
      let a = el.parentElement;
      let clipped = false;
      while (a) {
        const o = getComputedStyle(a).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") {
          clipped = true;
          break;
        }
        a = a.parentElement;
      }
      if (!clipped) out.push(`${el.tagName}.${String(el.className).slice(0, 40)} → ${Math.round(r.right)}px`);
    }
    return out.slice(0, 5);
  });

test("navigation follows the journey: Investigate → Positions → Strategy → Backtest → Execute → Reports → Activity", async ({ page }) => {
  await page.goto("/");
  const nav = await openNav(page);
  const labels = (await nav.locator("a").allInnerTexts()).map((t) => t.trim().split("\n")[0].trim());
  expect(labels).toEqual(NAV);
  await nav.getByRole("link", { name: /Activity/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your activity" })).toBeVisible();
});

test("glossary terms explain themselves on tap/click and on keyboard focus, and Escape closes them", async ({ page }) => {
  await page.goto("/");
  const term = page.locator("#wallet-help").getByRole("button", { name: "liquidity", exact: true });
  await term.click();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Liquidity");
  await expect(term).toHaveAttribute("aria-describedby", (await tip.getAttribute("id"))!);
  // The popover stays inside the viewport, also at 390px.
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // A second click closes it; Escape closes it too.
  await page.waitForTimeout(500);
  await term.click();
  await expect(tip).toHaveCount(0);
  await term.click();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  // Keyboard: focusing the term shows it.
  await term.evaluate((el) => (el as HTMLElement).blur());
  await term.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
});

test("every page renders a real investigation with no console errors, no sideways overflow, and keeps it on refresh", async ({ page, request }) => {
  const id = await doneInvestigation(request);
  test.skip(!id, "no completed investigation in the database yet");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

  await page.goto(`/positions?inv=${id}`);
  const detail = await page.getByRole("link", { name: /View details of/ }).first().getAttribute("href");

  const pages: [string, RegExp][] = [
    [`/?inv=${id}`, /Investigate another wallet/],
    [`/positions?inv=${id}`, /liquidity positions?/],
    [detail!, /What went into this position/],
    [`/case-study?inv=${id}`, /Evidence Explorer|Nothing to reconstruct/],
    [`/strategy?inv=${id}`, /A hypothesis, not confirmed intent/],
    [`/strategy?tab=versions&inv=${id}`, /Pick two to see what changed|No strategy versions/],
    [`/backtest?inv=${id}`, /How did this strategy perform\?/],
    [`/execute?inv=${id}`, /Run this strategy on 1inch Aqua/],
    [`/reports?inv=${id}`, /What TRACE found/],
    [`/activity?inv=${id}`, /Your activity/],
  ];
  for (const [path, marker] of pages) {
    await page.goto(path);
    await expect(page.getByText(marker).first()).toBeAttached({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    expect(await overflowing(page), `overflow on ${path}`).toEqual([]);
    if (path.startsWith("/?")) continue; // Investigate starts fresh on refresh (tested in trace.spec)
    // Refresh keeps the investigation on every other page.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`inv=${id}`));
    await expect(page.getByText(marker).first()).toBeAttached({ timeout: 30_000 });
  }
  expect(errors).toEqual([]);
});

test("the liquidity terrain renders in 3D, and falls back to an honest 2D view without WebGL", async ({ page, browser, request }) => {
  const id = await doneInvestigation(request);
  test.skip(!id, "no completed investigation in the database yet");
  await page.goto(`/positions?inv=${id}`);
  const figure = page.getByRole("figure", { name: /3D view of the wallet's liquidity positions/ });
  await expect(figure).toBeVisible();
  const hasGl = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl")));
  if (hasGl) await expect(figure.locator("canvas")).toBeVisible({ timeout: 20_000 });

  // Same page in a browser without WebGL.
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: any[]) {
      return type.startsWith("webgl") || type === "experimental-webgl" ? null : orig.call(this, type as "2d", ...rest);
    } as typeof orig;
  });
  const p2 = await ctx.newPage();
  await p2.goto(`/positions?inv=${id}`);
  const f2 = p2.getByRole("figure", { name: /3D view/ });
  await expect(f2.getByText(/2D view \(this browser has no WebGL\)|The 3D view needs WebGL/)).toBeVisible();
  await expect(f2.locator("canvas")).toHaveCount(0);
  await ctx.close();
});
