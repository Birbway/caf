// Optional browser check of CV Studio. Build a fictional root with
// node tests/fixtures/cv-studio/make-root.mjs, start the dashboard with it as
// CAREER_OPS_ROOT, then set CV_STUDIO_TEST_URL and CV_STUDIO_TEST_ROOT.
// CV_STUDIO_SHOTS names a local directory for screenshots.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const url = process.env.CV_STUDIO_TEST_URL;
const root = process.env.CV_STUDIO_TEST_ROOT;
const shots = process.env.CV_STUDIO_SHOTS;

test("hide, reorder, and save a tailored CV in CV Studio", { skip: !url || !root, timeout: 120_000 }, async (t) => {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
  assert.equal(fs.readFileSync(path.join(root, ".cv-studio-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = (name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const preview = () => page.frameLocator('iframe[title="CV preview"]').locator("body");

  await page.goto(new URL("/pipeline/7/cv", url).href);
  await page.getByRole("heading", { name: "Staff Platform Engineer at Northwind Labs" }).waitFor();
  await assert.doesNotReject(preview().getByText("Organized the quarterly hackathon").waitFor({ timeout: 30_000 }));
  await shot("studio-open");

  await page.getByRole("button", { name: "Leave out Organized the quarterly hackathon" }).click();
  await preview().getByText("Organized the quarterly hackathon").waitFor({ state: "detached", timeout: 15_000 });
  await page.getByRole("button", { name: "Move Led a team of 5 engineers on the billing rewrite up" }).click();
  const start = Date.now();
  for (;;) {
    const text = await preview().innerText();
    if (text.indexOf("Led a team of 5") > -1 && text.indexOf("Led a team of 5") < text.indexOf("Cut deploy time")) break;
    if (Date.now() - start > 15_000) assert.fail("preview did not show the moved bullet first");
    await page.waitForTimeout(100);
  }
  await shot("studio-edited");

  await page.getByRole("button", { name: "Save and use when applying" }).click();
  await page.getByRole("status").filter({ hasText: "Saved as v1. Applying to this job now attaches it." }).waitFor({ timeout: 60_000 });
  await page.getByText("used when applying").waitFor();
  await shot("studio-saved");

  const served = await page.request.get(new URL("/api/cv-pdf?n=7", url).href);
  assert.equal(served.status(), 200);
  const v1 = fs.readFileSync(path.join(root, "output/studio/7/v1/cv-jordan-rivera-northwind-labs-2026-10-14.pdf"));
  assert.equal(Buffer.compare(await served.body(), v1), 0, "the apply flow now serves the saved version");
  assert.deepEqual(errors, []);
});
