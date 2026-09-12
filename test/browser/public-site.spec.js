import { test, expect } from "@playwright/test";

test("public landing and pricing remain usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Know when client forms stop delivering email/i })).toBeVisible();
  await page.getByRole("link", { name: "View pricing" }).click();
  await expect(page.getByText("€49", { exact: true })).toBeVisible();
  await expect(page.getByText("€129", { exact: true })).toBeVisible();
  await expect(page.getByText("€299", { exact: true })).toBeVisible();
});

test("compatibility checker rejects a non-HTTPS target", async ({ page }) => {
  await page.goto("/#checker");
  await page.getByLabel("WordPress site URL").fill("http://example.com");
  await page.getByRole("button", { name: "Check compatibility" }).click();
  await expect(page.locator("[data-result]")).toContainText("UNSUPPORTED");
});

test("launch pages and discovery files are public", async ({ page, request }) => {
  await page.goto("/contact-form-7-email-monitoring/");
  await expect(page.getByRole("heading", { name: /Verify that WordPress form email actually arrives/i })).toBeVisible();
  for (const path of ["/wordpress-agency-form-monitoring/", "/wordpress-form-email-delivery-check/", "/robots.txt", "/sitemap.xml"]) {
    expect((await request.get(path)).ok()).toBeTruthy();
  }
});
