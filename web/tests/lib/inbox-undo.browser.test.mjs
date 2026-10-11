// Optional browser regression. Generate a disposable root with
// node tests/fixtures/inbox-undo.mjs and use it as CAREER_OPS_ROOT for the server.
// Set INBOX_UNDO_TEST_URL and INBOX_UNDO_TEST_ROOT when running this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const url = process.env.INBOX_UNDO_TEST_URL;
const root = process.env.INBOX_UNDO_TEST_ROOT;

test("Inbox Undo remains retryable after failure", { skip: !url || !root, timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inbox-undo-fixture"), "utf8").trim(), "fictional-only");
  const pipeline = path.join(root, "data/pipeline.md");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let release = () => {};
  t.after(async () => { release(); await page.unrouteAll({ behavior: "wait" }); await browser.close(); });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const row = (company) => page.locator("li").filter({ hasText: company });
  const undo = () => page.getByRole("button", { name: "Undo", exact: true });
  const retry = () => page.getByRole("button", { name: "Retry undo", exact: true });
  async function until(check) {
    const start = Date.now();
    while (!await check()) {
      if (Date.now() - start > 15_000) assert.fail("UI did not reach expected state");
      await page.waitForTimeout(50);
    }
  }
  // Warm the endpoint and reset this disposable fixture before the five-second
  // Undo window starts; a cold dev compilation is not part of the interaction.
  for (const company of ["alpha", "beta"]) {
    const response = await page.request.post(`${origin.origin}/api/inbox/skip`, { data: { url: `https://example.com/fixture-${company}`, done: false } });
    assert.equal(response.ok(), true);
  }
  await page.goto(`${origin.origin}/pipeline`);

  let restores = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/inbox/skip", async (route) => {
    if (route.request().postDataJSON().done !== false) return route.continue();
    restores++;
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture pipeline busy" }) });
  });
  await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").click({ noWaitAfter: true });
  await undo().focus();
  await page.keyboard.press("Enter");
  const pending = page.getByRole("button", { name: "Undoing…", exact: true });
  await pending.waitFor();
  assert.equal(await pending.isDisabled(), true);
  await page.waitForTimeout(5200); // the original toast timeout must not hide a pending restore
  assert.equal(await pending.isVisible(), true);
  release();
  await page.getByRole("alert").filter({ hasText: "Fixture pipeline busy" }).waitFor();
  assert.equal(await retry().isEnabled(), true);
  assert.equal(restores, 1);
  assert.ok(fs.readFileSync(pipeline, "utf8").includes("[x] https://example.com/fixture-alpha"));
  await page.waitForTimeout(5200); // failures do not expire before the user can retry
  assert.equal(await retry().isVisible(), true);
  await page.unroute("**/api/inbox/skip");
  await retry().click();
  await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").waitFor();
  assert.ok(fs.readFileSync(pipeline, "utf8").includes("[ ] https://example.com/fixture-alpha"));
  assert.equal(await retry().count(), 0);

  // The last Skip refreshes the inbox to zero rows. Its Undo must stay mounted.
  await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").click();
  await until(() => fs.readFileSync(pipeline, "utf8").includes("[x] https://example.com/fixture-alpha"));
  await page.setViewportSize({ width: 390, height: 844 });
  await row("Fixture Beta").getByTitle("Skip — hide from the inbox").click();
  await until(() => fs.readFileSync(pipeline, "utf8").includes("[x] https://example.com/fixture-beta"));
  await page.getByText("Your inbox is empty.", { exact: true }).waitFor();
  assert.equal(await undo().isVisible(), true);
  assert.equal(await undo().evaluate((el) => el.getBoundingClientRect().height >= 44), true);
  await undo().click();
  await row("Fixture Beta").getByTitle("Skip — hide from the inbox").waitFor();
  assert.deepEqual(errors, []);
});
