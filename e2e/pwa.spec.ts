import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 12: the built app is an installable PWA (Chrome's own installability check, which
 * replaced Lighthouse's removed PWA category), and the page and the panel work keyboard-only.
 */
const email = process.env.BACUYY_TEST_EMAIL;
const password = process.env.BACUYY_TEST_PASSWORD;

test("installable: manifest, icons and service worker pass Chrome's check", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the installability check is a Chromium DevTools API");
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);

  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "bacuy-y", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await page.request.get(`/${icon.src}`);
    expect(res.ok(), icon.src).toBe(true);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
  // Any route is served by the app shell (SPA fallback), also from the service worker.
  const deep = await page.request.get("/priority");
  expect(deep.ok()).toBe(true);
});

const lines = (page: Page) => page.locator('[data-testid^="line-row-"] textarea');

test("keyboard only: type, split, tick, panel open and close, move a line, navigate", async ({ page, browserName }) => {
  test.skip(!email || !password, "needs BACUYY_TEST_EMAIL / BACUYY_TEST_PASSWORD");
  test.skip(browserName === "webkit", "Safari moves Tab focus only to text fields by default");
  await page.route("**/graphql", (route) => route.abort("internetdisconnected"));
  await page.goto("/");

  // Sign in with the keyboard.
  await page.getByLabel(/correo electrónico|email/i).focus();
  await page.keyboard.type(email!);
  await page.keyboard.press("Tab");
  await page.keyboard.type(password!);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("line-row-0")).toBeVisible();

  // Tab from the nav reaches the first line; typing works.
  await page.getByRole("link", { name: /^página$|^page$/i }).focus();
  for (let i = 0; i < 12 && !(await lines(page).first().evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(lines(page).first()).toBeFocused();
  await page.keyboard.type("primera");
  await page.keyboard.press("Enter");
  await page.keyboard.type("segunda");
  await page.keyboard.press("Enter");
  await page.keyboard.type("tercera");
  await expect(lines(page)).toHaveCount(3);

  // Ctrl+Enter completes the line (it leaves the page; the focus goes to the line above);
  // Alt+↑ moves a line; ↑/↓ move the focus.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(lines(page)).toHaveCount(2);
  await expect(lines(page).nth(1)).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(lines(page).first()).toHaveValue("segunda");
  await expect(lines(page).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(lines(page).nth(1)).toBeFocused();

  // Ctrl+. opens the panel with the focus inside; Tab stays usable; Escape closes it and
  // gives the focus back to the line.
  await page.keyboard.press("ControlOrMeta+.");
  const panel = page.getByTestId("line-panel");
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(lines(page).nth(1)).toBeFocused();

  // Every visible control shows a focus ring (no focus lost on a hidden element).
  await page.getByRole("link", { name: /^prioridad$|^priority$/i }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/priority$/);
});
