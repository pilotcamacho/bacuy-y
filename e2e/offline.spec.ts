import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Offline after one online visit (CLAUDE.md, the most important requirement; Phase 12):
 * the service worker serves the app shell, so a reload with no network opens the page from
 * IndexedDB; edits survive another offline reload; back online they sync, and a second
 * browser sees them. Real backend; this run's line is deleted at the end.
 * Skipped unless a test account is set in .env.test.local.
 */
const email = process.env.BACUYY_TEST_EMAIL;
const password = process.env.BACUYY_TEST_PASSWORD;

test.skip(!email || !password, "needs BACUYY_TEST_EMAIL / BACUYY_TEST_PASSWORD");

const lines = (page: Page) => page.locator('[data-testid^="line-row-"] textarea');
const values = (page: Page) => lines(page).evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

async function open(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel(/correo electrónico|email/i).fill(email!);
  await page.getByLabel(/^contraseña$|^password$/i).fill(password!);
  await page.getByRole("button", { name: /entrar|sign in/i }).click();
  await expect(page.getByTestId("line-row-0")).toBeVisible();
  await syncUntilClean(page);
  return { context, page };
}

async function syncUntilClean(page: Page) {
  const indicator = page.getByTestId("sync-indicator");
  await expect(async () => {
    await indicator.click();
    await expect(indicator).toHaveAttribute("data-status", "synced", { timeout: 4_000 });
    await expect(indicator).toHaveAttribute("data-dirty", "0", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

test("after one online visit: reload offline, edit, reload offline again, then sync when back online", async ({ browser }) => {
  test.setTimeout(120_000);
  const run = `offline-${test.info().project.name}-${Date.now().toString(36)}`;
  const a = await open(browser);
  let b: { context: BrowserContext; page: Page } | null = null;
  try {
    // The service worker has installed (app shell precached) and controls the page.
    await a.page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });

    // 1. No network, reload: the page opens (signed in, from the cached session).
    await a.context.setOffline(true);
    await a.page.reload();
    await expect(a.page.getByTestId("line-row-0")).toBeVisible();
    const indicator = a.page.getByTestId("sync-indicator");
    await expect(indicator).toHaveAttribute("data-status", "offline");

    // 2. Edit offline: a new line at the end.
    await lines(a.page).last().click();
    await a.page.keyboard.press("End");
    if ((await lines(a.page).last().inputValue()) !== "") await a.page.keyboard.press("Enter");
    await a.page.keyboard.type(`${run} escrito sin red`);
    await lines(a.page).last().blur();

    // 3. Reload, still offline: the edit is there, waiting to be uploaded.
    await a.page.reload();
    await expect(a.page.getByTestId("line-row-0")).toBeVisible();
    await expect.poll(() => values(a.page)).toContain(`${run} escrito sin red`);
    await expect(indicator).not.toHaveAttribute("data-dirty", "0");

    // 4. Back online: it syncs, and another browser gets it.
    await a.context.setOffline(false);
    await syncUntilClean(a.page);
    b = await open(browser);
    await expect.poll(() => values(b!.page), { timeout: 15_000 }).toContain(`${run} escrito sin red`);
  } finally {
    await a.context.setOffline(false);
    const all = await values(a.page);
    const index = all.findIndex((v) => v.startsWith(run));
    if (index >= 0) {
      await lines(a.page).nth(index).click();
      await a.page.keyboard.press("ControlOrMeta+.");
      await a.page.getByTestId("line-panel").getByRole("button", { name: /borrar renglón|delete line/i }).click();
      await syncUntilClean(a.page);
    }
    await a.context.close();
    await b?.context.close();
  }
});
