import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
import * as yaml from "js-yaml";

// Same alias-loader convention as profile-write-shape.test.mjs: the real route
// handlers and safe writer run, with only CAREER_OPS_ROOT redirected.
const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));

const { GET, POST } = await import("../../src/app/api/page-format/route.ts");

const template = "candidate:\n  full_name: Template Candidate\ncompensation:\n  currency: USD\n";

async function withFixture(source, fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-page-format-route-"));
  const config = path.join(root, "config");
  const file = path.join(config, "profile.yml");
  mkdirSync(config);
  writeFileSync(path.join(config, "profile.example.yml"), template);
  if (source !== undefined) writeFileSync(file, source);
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    await fn({ config, file });
  } finally {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

const post = (body) =>
  POST(new Request("http://fixture.invalid/api/page-format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

test("GET reports the accepted formats, the default and the profile's own choice", async () => {
  await withFixture("candidate:\n  full_name: Fixture\npage_format: a4\n", async () => {
    const body = await (await GET()).json();
    assert.deepEqual([...body.formats].sort(), ["a4", "letter"]);
    assert.equal(body.default, "letter");
    assert.equal(body.override, "a4");
    assert.equal(body.effective, "a4");
  });
});

test("GET falls back to the default when the profile states nothing or is absent", async () => {
  for (const source of ["candidate:\n  full_name: Fixture\n", "page_format: foolscap\n", undefined]) {
    await withFixture(source, async () => {
      const body = await (await GET()).json();
      assert.equal(body.override, null);
      assert.equal(body.effective, "letter");
    });
  }
});

test("POST writes page_format, keeps every other key and backs up the original bytes", async () => {
  const source = "# keep these bytes in the backup\ncandidate:\n  full_name: Fixture\ncompensation:\n  target_range: 100-120\n";
  await withFixture(source, async ({ config, file }) => {
    const response = await post({ page_format: " A4 " });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, override: "a4", effective: "a4" });
    assert.deepEqual(yaml.load(readFileSync(file, "utf8")), { ...yaml.load(source), page_format: "a4" });
    const backups = readdirSync(config).filter((name) => name.startsWith("profile.yml.bak-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(path.join(config, backups[0]), "utf8"), source);
  });
});

test("POST null removes the key and leaves the rest of the profile alone", async () => {
  await withFixture("candidate:\n  full_name: Fixture\npage_format: a4\n", async ({ file }) => {
    const response = await post({ page_format: null });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, override: null, effective: "letter" });
    assert.deepEqual(yaml.load(readFileSync(file, "utf8")), { candidate: { full_name: "Fixture" } });
  });
});

test("POST creates a missing profile from the template", async () => {
  await withFixture(undefined, async ({ config, file }) => {
    assert.equal(existsSync(file), false);
    const response = await post({ page_format: "letter" });
    assert.equal(response.status, 200);
    assert.deepEqual(yaml.load(readFileSync(file, "utf8")), { ...yaml.load(template), page_format: "letter" });
    assert.deepEqual(readdirSync(config).sort(), ["profile.example.yml", "profile.yml"]);
  });
});

test("POST rejects a value that is not an accepted format", async () => {
  await withFixture("candidate:\n  full_name: Fixture\n", async ({ file }) => {
    for (const bad of ["legal", 4, ["a4"], {}, true]) {
      const response = await post({ page_format: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match((await response.json()).error, /a4, letter/);
    }
    assert.equal(readFileSync(file, "utf8"), "candidate:\n  full_name: Fixture\n");
  });
});

test("POST rejects a body without the page_format key", async () => {
  await withFixture("candidate:\n  full_name: Fixture\n", async () => {
    assert.equal((await post({})).status, 400);
  });
});

test("POST refuses an existing profile that is not a YAML mapping, without touching it", async () => {
  for (const source of ["- candidate:\n    full_name: Fixture\n", "42\n", "null\n", "# Existing profile to repair\n", "candidate: [broken\n"]) {
    await withFixture(source, async ({ config, file }) => {
      const before = readdirSync(config).sort();
      const response = await post({ page_format: "a4" });
      assert.equal(response.status, 409, JSON.stringify(source));
      assert.match((await response.json()).error, /refusing to overwrite/i);
      assert.equal(readFileSync(file, "utf8"), source);
      assert.deepEqual(readdirSync(config).sort(), before, "no backup or temp files on rejection");
    });
  }
});

test("the Config page renders the Page format control", () => {
  const form = readFileSync(new URL("../../src/components/config-form.tsx", import.meta.url), "utf8");
  assert.match(form, /import\s*{\s*PageFormatSettings\s*}\s*from\s*"@\/components\/page-format-settings"/);
  assert.match(form, /<PageFormatSettings\s*\/>/);
});

test("the control names its option group, announces save errors and clears a stale one", () => {
  const src = readFileSync(new URL("../../src/components/page-format-settings.tsx", import.meta.url), "utf8");
  assert.match(src, /<span id="page-format-label"/);
  assert.match(src, /role="group"\s+aria-labelledby="page-format-label"/);
  assert.match(src, /role="alert"[^>]*>\{error\}/);
  assert.match(src, /onClick=\{\(\) => \{\s*setChoice\(o\.value\);\s*setError\(null\);\s*\}\}/);
});
