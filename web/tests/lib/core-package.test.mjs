// Tests for findCorePackage() / linkCorePackage(), which put a core dependency
// within reach of a core module copied into a throwaway directory.
//
// The case that matters is a git worktree: no node_modules of its own, with the
// packages one or more directories up, where Node finds them for every real
// import. cv-template.test.mjs linked `<core>/node_modules` directly, so in a
// worktree the link dangled and four of its five cases failed on the base
// template while the code they test was fine.
//
// Run:  node --test tests/lib/core-package.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findCorePackage, linkCorePackage } from "../helpers/core-package.mjs";

/** A temp directory tree; `install` writes a package under `<dir>/node_modules`. */
function tree(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "core-package-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const install = (dir, pkg, main = "export default 'x';") => {
    const at = path.join(base, dir, "node_modules", pkg);
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(path.join(at, "package.json"), JSON.stringify({ name: pkg, type: "module", exports: "./index.js" }));
    fs.writeFileSync(path.join(at, "index.js"), main);
    return at;
  };
  const dir = (rel) => {
    const at = path.join(base, rel);
    fs.mkdirSync(at, { recursive: true });
    return at;
  };
  return { base, install, dir };
}

test("findCorePackage: a worktree with no node_modules finds the package in a parent directory", (t) => {
  const { install, dir } = tree(t);
  const installed = install("main", "demo");
  const worktree = dir("main/.claude/worktrees/wt");

  assert.equal(findCorePackage("demo", worktree), installed);
});

test("findCorePackage: the checkout's own installation wins over a parent's", (t) => {
  const { install, dir } = tree(t);
  install("main", "demo");
  const own = install("main/.claude/worktrees/wt", "demo");

  assert.equal(findCorePackage("demo", dir("main/.claude/worktrees/wt")), own);
});

test("findCorePackage: scoped names resolve, and a directory without package.json is not an installation", (t) => {
  const { install, dir, base } = tree(t);
  const scoped = install("main", "@demo/scoped");
  fs.mkdirSync(path.join(base, "main", "wt", "node_modules", "@demo", "scoped"), { recursive: true });

  assert.equal(findCorePackage("@demo/scoped", dir("main/wt")), scoped);
});

test("findCorePackage: null when the package is installed nowhere above", (t) => {
  const { install, dir } = tree(t);
  install("main", "other");

  assert.equal(findCorePackage("career-ops-no-such-package-7c1e", dir("main/wt")), null);
});

test("findCorePackage: never looks for node_modules/node_modules", (t) => {
  const { install, dir } = tree(t);
  const installed = install("main", "demo");
  // Starting inside node_modules, Node skips `node_modules/node_modules/demo`
  // and finds the package beside the directory it started in.
  assert.equal(findCorePackage("demo", dir("main/node_modules")), installed);
});

test("linkCorePackage: a module copied out of a worktree can import the package", async (t) => {
  const { install, dir } = tree(t);
  // The package has a dependency of its own, installed beside it. It must come
  // along without being linked, which is why one package is enough.
  install("main", "demo-dep", "export default 'from the dependency';");
  install("main", "demo", "import dep from 'demo-dep'; export default dep;");
  const worktree = dir("main/.claude/worktrees/wt");
  const sandbox = dir("elsewhere/sandbox");
  fs.writeFileSync(path.join(sandbox, "copied.mjs"), "export { default } from 'demo';");

  linkCorePackage(sandbox, "demo", worktree);

  const mod = await import(pathToFileURL(path.join(sandbox, "copied.mjs")).href);
  assert.equal(mod.default, "from the dependency");
});

test("linkCorePackage: says so when the package is not installed, and leaves no link", (t) => {
  const { dir } = tree(t);
  const sandbox = dir("sandbox");

  assert.throws(() => linkCorePackage(sandbox, "career-ops-no-such-package-7c1e", dir("main/wt")), /is not installed/);
  assert.equal(fs.existsSync(path.join(sandbox, "node_modules")), false);
});
