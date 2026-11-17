import { expect, test, type Page } from "@playwright/test";

/**
 * The page against the built app (service worker comes in Phase 12) with a real sign-in.
 * Skipped unless a test account is set in .env.test.local (see .env.test.local.example).
 * These specs are about the local editor: AppSync is blocked, so the account's lines in the
 * cloud (from other runs) never reach the page, and each test starts on an empty page.
 * Sync between browsers is covered by e2e/sync.spec.ts (Phase 8).
 */
const email = process.env.BACUYY_TEST_EMAIL;
const password = process.env.BACUYY_TEST_PASSWORD;

test.skip(!email || !password, "needs BACUYY_TEST_EMAIL / BACUYY_TEST_PASSWORD");
// Requests that go through the service worker skip page.route (seen in WebKit): without it,
// AppSync is reliably blocked and no test pulls another test's lines from the cloud.
test.use({ serviceWorkers: "block" });

async function signIn(page: Page) {
  await page.route("**/graphql", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await page.getByLabel(/correo electrónico|email/i).fill(email!);
  await page.getByLabel(/^contraseña$|^password$/i).fill(password!);
  await page.getByRole("button", { name: /entrar|sign in/i }).click();
  await expect(page.getByTestId("line-row-0")).toBeVisible();
}

const lines = (page: Page) => page.locator('[data-testid^="line-row-"] textarea');

test("type lines, reload, they are still there", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("uno");
  await page.keyboard.press("Enter");
  await page.keyboard.type("dos #salud");
  await page.keyboard.press("Enter");
  await page.keyboard.type("tres");
  await expect(lines(page)).toHaveCount(3);
  await page.waitForTimeout(500); // text debounce

  await page.reload();
  await expect(lines(page)).toHaveCount(3);
  await expect(lines(page).nth(1)).toHaveValue("dos #salud");
});

test("split, merge and move", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("pan leche");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(lines(page)).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page).first()).toHaveValue("pan leche");

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("segunda");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(lines(page).first()).toHaveValue("segunda");
});

test("drag a line with the handle", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("a");
  await page.keyboard.press("Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Enter");
  await page.keyboard.type("c");
  const handle = page.getByTestId("line-handle-2");
  const target = page.getByTestId("line-row-0");
  await page.getByTestId("line-row-2").hover();
  await handle.hover();
  const start = (await handle.boundingBox())!;
  await page.mouse.down();
  // A first short move activates the drag (4 px threshold), as a real hand does; then go to
  // the target and wait until the line has visibly moved before dropping. WebKit sometimes
  // coalesced one long move into nothing.
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 - 8, { steps: 4 });
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 12 });
  // Wait until the line has travelled (most of) the way up, not just past the 4 px threshold.
  const travel = start.y - box.y;
  await expect
    .poll(async () => {
      const style = (await page.getByTestId("line-row-2").getAttribute("style")) ?? "";
      const m = /translate3d\(0px, (-?[\d.]+)px/.exec(style);
      return m ? -Number(m[1]) : 0;
    })
    .toBeGreaterThan(travel * 0.6);
  // One more small move, as a hand never stops dead: WebKit's last coalesced move can leave
  // dnd-kit's "over" target one row behind the pointer.
  await page.mouse.move(box.x + box.width / 2, box.y + 1, { steps: 2 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await expect(lines(page).first()).toHaveValue("c");
});

test("tag a line from the side panel, tick it: it moves to Completed; unticking there brings it back", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("llamar al banco");

  await page.keyboard.press("ControlOrMeta+.");
  const panel = page.getByTestId("line-panel");
  await expect(panel).toBeVisible();
  await panel.getByLabel(/añadir bandera|add flag/i).selectOption({ index: 1 });
  await expect(lines(page).first()).toHaveValue(/^llamar al banco #\S+$/);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  await page.getByTestId("line-done-0").click();
  await expect(page.getByTestId("completed-toast")).toBeVisible();
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page).first()).toHaveValue(""); // only the empty line to type in

  await page.getByTestId("line-tabs").getByRole("link", { name: /^completadas$|^completed$/i }).click();
  await expect(page).toHaveURL(/\/completed$/);
  await expect(page.getByTestId("completed-item-0")).toContainText(/llamar al banco #\S+/);
  await page.reload();
  await expect(page.getByTestId("completed-item-0")).toContainText("llamar al banco");

  await page.getByTestId("completed-reopen-0").click();
  await expect(page.locator('[data-testid^="completed-item-"]')).toHaveCount(0);
  await page.getByTestId("line-tabs").getByRole("link", { name: /^pendientes$|^to do$/i }).click();
  await expect(lines(page).first()).toHaveValue(/^llamar al banco #\S+$/);
});

test("a flag created on the Flags screen resolves the line's mark; weights must sum to 100", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("nadar #natación");
  await page.waitForTimeout(500); // text debounce

  await page.getByRole("link", { name: /^banderas$|^flags$/i }).click();
  await page.getByRole("button", { name: /añadir subbandera a salud|add a subflag to health/i }).click();
  await page.keyboard.type("Natación");
  await page.keyboard.press("Enter");
  await expect(page.locator('input[value="Natación"]')).toBeVisible();

  // Weights: a second subflag (the form stays open) starts at 0; moving 30 to it needs the
  // first one lowered too.
  await page.keyboard.type("Correr");
  await page.keyboard.press("Enter");
  const correr = page.getByRole("spinbutton", { name: /peso de correr|weight of correr/i });
  await correr.fill("30");
  const save = page.locator('[data-testid^="flags-save-"]');
  await expect(save).toBeDisabled();
  await page.getByRole("spinbutton", { name: /peso de natación|weight of natación/i }).fill("70");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toHaveCount(0);

  await page.getByRole("link", { name: /^página$|^page$/i }).click();
  await expect(lines(page).first()).toHaveValue("nadar #natación");
  await page.getByTestId("line-more-0").click();
  await expect(page.getByTestId("line-panel").getByText(/Salud › Natación|Health › Natación/)).toBeVisible();
});

test("after a tick, '¿Cómo fue?' leads to the feedback form", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("llamar a Ana #familia");
  await page.getByTestId("line-done-0").click();
  const prompt = page.getByTestId("feedback-prompt");
  await expect(prompt).toBeVisible();
  await prompt.click();
  const panel = page.getByTestId("line-panel");
  const form = panel.getByTestId("feedback-form");
  await form.getByLabel(/^5 (de|of) 5$/).locator("..").click(); // the star (the radio is visually hidden)
  await form.getByLabel(/^(ánimo|mood)$/i).fill("0.6");
  await form.getByLabel(/^(notas|notes)$/i).fill("muy bien");
  await form.getByRole("button", { name: /guardar valoración|save feedback/i }).click();
  const list = panel.getByTestId("feedback-list");
  await expect(list.getByText("muy bien")).toBeVisible();
  await expect(list.getByLabel(/^5 (de|of) 5$/)).toBeVisible();
});

test("priority view orders by flag weight and goes to the line; archive and restore", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("pagar luz #recados"); // Recados 10
  await page.keyboard.press("Enter");
  await page.keyboard.type("correr #salud"); // Salud 15
  await page.keyboard.press("Enter");
  await page.keyboard.type("sin bandera");
  await page.waitForTimeout(500); // text debounce

  await page.getByRole("link", { name: /^prioridad$|^priority$/i }).click();
  const items = page.locator('[data-testid^="priority-item-"]');
  await expect(items).toHaveCount(2); // the line without a flag is a draft
  await expect(items.nth(0)).toContainText("correr");
  await expect(items.nth(1)).toContainText("pagar luz");
  await items.nth(1).getByRole("button", { name: /^pagar luz/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(lines(page).nth(0)).toBeFocused();

  // Archive "correr" from its panel: it leaves the page and shows under Archived.
  await page.getByTestId("line-more-1").click();
  await page.getByTestId("line-panel").getByRole("button", { name: /^archivar$|^archive$/i }).click();
  await expect(lines(page)).toHaveCount(2);
  await page.getByRole("link", { name: /^archivadas$|^archived$/i }).click();
  await expect(page.getByTestId("archived-item-0")).toContainText("correr #salud");
  await page.getByTestId("archived-restore-0").click();
  await expect(page.locator('[data-testid^="archived-item-"]')).toHaveCount(0);

  // Back at the end of the page, active again (it has a flag), and still there after a reload.
  await page.getByRole("link", { name: /^página$|^page$/i }).click();
  await expect(lines(page)).toHaveCount(3);
  await expect(lines(page).nth(2)).toHaveValue("correr #salud");
  await page.reload();
  await expect(lines(page).nth(2)).toHaveValue("correr #salud");
});

test("a repetitive task ticked is hidden until next time, also after a reload; 'show now' brings it back", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("regar plantas ~semanal");
  await page.keyboard.press("Enter");
  await page.keyboard.type("otra cosa");
  await page.waitForTimeout(500); // text debounce

  await page.getByTestId("line-done-0").click();
  await expect(page.getByTestId("hidden-toast")).toBeVisible();
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page).first()).toHaveValue("otra cosa");

  await page.reload();
  await expect(lines(page)).toHaveCount(1);
  await expect(page.getByTestId("hidden-count")).toHaveText("1");
  await page.getByTestId("line-tabs").getByRole("link", { name: /^ocultas|^hidden/i }).click();
  await expect(page.getByTestId("hidden-item-0")).toContainText("regar plantas ~semanal");
  await page.getByTestId("hidden-show-0").click();
  await expect(page.locator('[data-testid^="hidden-item-"]')).toHaveCount(0);
  await page.getByTestId("line-tabs").getByRole("link", { name: /^pendientes$|^to do$/i }).click();
  await expect(lines(page)).toHaveCount(2);
  await expect(lines(page).first()).toHaveValue("regar plantas ~semanal");
  await expect(page.getByTestId("line-done-0")).toContainText("↻ 1");
});

test("hide a line from the panel until a date and time; it stays hidden after a reload; change it on the Hidden tab", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("renovar seguro");
  await page.keyboard.press("Enter");
  await page.keyboard.type("otra cosa");
  await page.waitForTimeout(500); // text debounce

  await page.getByTestId("line-more-0").click();
  const panel = page.getByTestId("line-panel");
  await panel.getByTestId("panel-hide-custom").fill("2030-01-15T09:30");
  await panel.getByTestId("panel-hide-custom-apply").click();
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("hidden-toast")).toContainText(/oculta hasta|hidden until/i);
  await expect(lines(page)).toHaveCount(1);

  await page.reload();
  await expect(lines(page)).toHaveCount(1);
  await page.getByTestId("line-tabs").getByRole("link", { name: /^ocultas|^hidden/i }).click();
  const item = page.getByTestId("hidden-item-0");
  await expect(item).toContainText("renovar seguro");
  await expect(item.locator("time")).toHaveAttribute("datetime", new Date(2030, 0, 15, 9, 30).toISOString());

  await page.getByTestId("hidden-change-0").click();
  await page.getByTestId("hidden-0-indefinite").click();
  await expect(item).toContainText(/hasta que lo muestres|until you show it/);
});

test("filter the page by flag: new lines get the flag, the filter survives a reload, clear shows all", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("correr #salud");
  await page.keyboard.press("Enter");
  await page.keyboard.type("pan #recados");
  await page.keyboard.press("Enter");
  await page.keyboard.type("idea suelta");
  await expect(lines(page)).toHaveCount(3);

  await page.getByTestId("flag-filter-toggle").click();
  await page.getByRole("checkbox", { name: /^(Salud|Health)$/ }).check();
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page).first()).toHaveValue("correr #salud");

  await lines(page).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("nadar");
  await expect(lines(page).nth(1)).toHaveValue(/^nadar #(salud|health)$/);
  await page.waitForTimeout(500); // text debounce

  await page.reload();
  await expect(lines(page)).toHaveCount(2);
  await expect(page.locator('[data-testid^="flag-filter-chip-"]')).toHaveText(/Salud|Health/);

  await page.getByTestId("flag-filter-clear").click();
  await expect(lines(page)).toHaveCount(4);
  await expect(lines(page).nth(1)).toHaveValue(/^nadar #(salud|health)$/); // typed right after "correr"
});

test("autocomplete: marks complete with Enter or a tap; earlier lines are suggested; Enter at the start adds a line above", async ({ page }) => {
  await signIn(page);
  await lines(page).first().click();
  await page.keyboard.type("comprar pan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("correr #sal");
  await expect(page.getByTestId("suggestions")).toContainText(/#(salud|health)/);
  await page.keyboard.press("Enter");
  await expect(lines(page).nth(1)).toHaveValue(/^correr #(salud|health) $/);
  await expect(page.getByTestId("suggestions")).toHaveCount(0);

  await page.keyboard.type("~");
  await page.getByTestId("suggestion-0").click(); // a tap keeps the focus in the line
  await expect(lines(page).nth(1)).toHaveValue(/^correr #(salud|health) ~(diario|daily) $/);
  await expect(lines(page).nth(1)).toBeFocused();

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("comp");
  await expect(page.getByTestId("suggestion-0")).toHaveText(/comprar pan/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(lines(page).nth(2)).toHaveValue("comprar pan");

  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(lines(page)).toHaveCount(4);
  await expect(lines(page).nth(2)).toHaveValue("");
  await expect(lines(page).nth(3)).toHaveValue("comprar pan");
  await expect(lines(page).nth(3)).toBeFocused();
});
