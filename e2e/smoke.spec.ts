import { expect, test } from "@playwright/test";

test("signed out: the built app opens the sign-in screen and links to sign-up", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator('a[href="/auth/sign-up"]').click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
});
