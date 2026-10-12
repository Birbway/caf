// The web's profile.yml path resolver must agree with the core's getProfilePath()
// (path-resolver.mjs): the CAREER_OPS_PROFILE override wins when no root is
// stated, and an explicit root names its own config/profile.yml (#5026).
//
// The web cannot import the core helper (Turbopack's root is pinned to web/), so
// this is a mirror; tests/web-profile-path-parity.test.mjs in the root suite is
// the guard that keeps the two contracts from drifting.
//
// Run:  node --test tests/lib/profile-path.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getProfilePath } from "../../src/lib/core/profile-path.mjs";

const ROOT = path.resolve("/fixture/data-root");
const DEFAULT = path.join(ROOT, "config", "profile.yml");
const OVERRIDE = path.resolve("/fixture/elsewhere/me.yml");

test("no override: <root>/config/profile.yml", () => {
  assert.equal(getProfilePath(ROOT, { env: {} }), DEFAULT);
});

test("override wins when the root is the web's derived data root", () => {
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: OVERRIDE } }), OVERRIDE);
});

test("override is trimmed", () => {
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: `  ${OVERRIDE}\n` } }), OVERRIDE);
});

test("empty or whitespace override counts as unset", () => {
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: "" } }), DEFAULT);
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: "   \t " } }), DEFAULT);
});

test("an explicit root beats the override", () => {
  assert.equal(getProfilePath(ROOT, { explicitRoot: true, env: { CAREER_OPS_PROFILE: OVERRIDE } }), DEFAULT);
});

test("reads process.env by default", () => {
  const prev = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_PROFILE = OVERRIDE;
  try {
    assert.equal(getProfilePath(ROOT), OVERRIDE);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = prev;
  }
});

// A relative CAREER_OPS_PROFILE resolves against the codebase root (the checkout
// containing web/), like CAREER_OPS_ROOT, never against the working directory.
// Mirrors the documented contract of the core's getProfilePath().
const CODE = path.resolve("/fixture/checkout");

test("relative override resolves against the codebase root", () => {
  assert.equal(
    getProfilePath(ROOT, { codeRoot: CODE, env: { CAREER_OPS_PROFILE: "profiles/me.yml" } }),
    path.join(CODE, "profiles", "me.yml"),
  );
});

test("absolute override passes through unchanged whatever the codebase root", () => {
  assert.equal(getProfilePath(ROOT, { codeRoot: CODE, env: { CAREER_OPS_PROFILE: OVERRIDE } }), OVERRIDE);
});

test("relative override ignores the working directory (cwd = <checkout>/web, as under next)", async () => {
  const { fileURLToPath } = await import("node:url");
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const prev = { cwd: process.cwd(), profile: process.env.CAREER_OPS_PROFILE, code: process.env.CAREER_OPS_CODE_ROOT };
  process.chdir(path.join(checkout, "web"));
  process.env.CAREER_OPS_PROFILE = "profiles/me.yml";
  delete process.env.CAREER_OPS_CODE_ROOT;
  try {
    assert.equal(getProfilePath(ROOT), path.join(checkout, "profiles", "me.yml"));
  } finally {
    process.chdir(prev.cwd);
    for (const [k, v] of [["CAREER_OPS_PROFILE", prev.profile], ["CAREER_OPS_CODE_ROOT", prev.code]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("relative override with an unrelated cwd still hits the configured codebase root", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "profile-path-cwd-")));
  const prev = { cwd: process.cwd(), profile: process.env.CAREER_OPS_PROFILE, code: process.env.CAREER_OPS_CODE_ROOT };
  process.chdir(elsewhere);
  process.env.CAREER_OPS_PROFILE = "profiles/me.yml";
  process.env.CAREER_OPS_CODE_ROOT = CODE;
  try {
    assert.equal(getProfilePath(ROOT), path.join(CODE, "profiles", "me.yml"));
  } finally {
    process.chdir(prev.cwd);
    for (const [k, v] of [["CAREER_OPS_PROFILE", prev.profile], ["CAREER_OPS_CODE_ROOT", prev.code]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
