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
