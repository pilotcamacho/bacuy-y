import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Two browsers, one account, the real backend (CLAUDE.md, Phase 8):
 * an edit in A reaches B; both edit the same line offline, reconnect, and the later edit wins
 * on both. Each run works on its own uniquely named line and deletes it at the end.
 * Skipped unless a test account is set in .env.test.local. Chromium only: one browser is
 * enough to exercise the backend, and it keeps runs on the shared account from overlapping.
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

/** Debugging: this run's rows as stored in the page's IndexedDB. */
function localRows(page: Page, run: string) {
  return page.evaluate(
    (prefix) =>
      new Promise((resolve) => {
        const req = indexedDB.open("bacuyy");
        req.onsuccess = () => {
          const all = req.result.transaction("activities").objectStore("activities").getAll();
          all.onsuccess = () =>
            resolve(
              (all.result as { rawInput: string; editedAt: string; dirty: number; updatedAt?: string }[])
                .filter((r) => r.rawInput?.startsWith(prefix))
                .map((r) => [r.rawInput, r.editedAt, r.dirty, r.updatedAt]),
            );
        };
      }),
    run,
  );
}

/** Asks for a sync until the indicator says synced with nothing pending. */
async function syncUntilClean(page: Page) {
  const indicator = page.getByTestId("sync-indicator");
  await expect(async () => {
    await indicator.click();
    await expect(indicator).toHaveAttribute("data-status", "synced", { timeout: 4_000 });
    await expect(indicator).toHaveAttribute("data-dirty", "0", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

async function indexOf(page: Page, text: string): Promise<number> {
  let index = -1;
  await expect.poll(async () => (index = (await values(page)).indexOf(text)), { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  return index;
}

/** Replaces the text of a line and leaves it (commit), like a user would. */
async function rewrite(page: Page, index: number, text: string) {
  const box = lines(page).nth(index);
  await box.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await box.blur();
}

test("an edit in A reaches B; offline edits on both → the later one wins everywhere", async ({ browser }) => {
  test.skip(test.info().project.name !== "chromium", "sync spec runs once, in chromium");
  test.setTimeout(150_000);
  const run = `sync-${Date.now().toString(36)}`;
  const a = await open(browser);
  const b = await open(browser);
  try {
    // 1. A adds a line at the end of the page; B gets it.
    await lines(a.page).last().click();
    await a.page.keyboard.press("End");
    if ((await lines(a.page).last().inputValue()) !== "") await a.page.keyboard.press("Enter");
    await a.page.keyboard.type(`${run} uno`);
    await lines(a.page).last().blur();
    await syncUntilClean(a.page);
    await syncUntilClean(b.page);
    await indexOf(b.page, `${run} uno`);

    // 2. Both offline; A edits first, B a moment later.
    await a.context.setOffline(true);
    await b.context.setOffline(true);
    await rewrite(a.page, await indexOf(a.page, `${run} uno`), `${run} desde A`);
    await a.page.waitForTimeout(1_500);
    await rewrite(b.page, await indexOf(b.page, `${run} uno`), `${run} desde B`);
    await a.page.getByTestId("sync-indicator").click();
    await expect(a.page.getByTestId("sync-indicator")).toHaveAttribute("data-status", "offline");

    // 3. B reconnects first and pushes the later edit; A's older edit is then refused
    //    by the server and replaced by B's.
    await b.context.setOffline(false);
    await syncUntilClean(b.page);
    await a.context.setOffline(false);
    await syncUntilClean(a.page);
    await syncUntilClean(b.page);
    for (const page of [a.page, b.page]) {
      if (process.env.BACUYY_DEBUG) console.log("DEBUG", page === a.page ? "A" : "B", JSON.stringify(await localRows(page, run)), JSON.stringify(await values(page).then((v) => v.filter((x) => x.startsWith(run)))));
      const all = await values(page);
      expect(all).toContain(`${run} desde B`);
      expect(all).not.toContain(`${run} desde A`);
    }
  } finally {
    // Clean up: delete this run's line from A and sync, so the account does not grow.
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
    await b.context.close();
  }
});
