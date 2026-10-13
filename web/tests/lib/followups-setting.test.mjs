import { test } from "node:test";
import assert from "node:assert/strict";
import { followupsEnabledFromProfile } from "../../src/lib/followups-setting.mjs";
import { visibleNavItems } from "../../src/lib/nav-items.ts";

test("follow-ups stay on unless the profile says enabled: false", () => {
  assert.equal(followupsEnabledFromProfile(undefined), true);
  assert.equal(followupsEnabledFromProfile(null), true);
  assert.equal(followupsEnabledFromProfile({}), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: null }), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: { enabled: true } }), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: { enabled: "false" } }), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: { enabled: false } }), false);
});

test("the Follow-ups nav link is hidden only when follow-ups are off", () => {
  assert.equal(visibleNavItems(true).some((item) => item.href === "/followups"), true);
  assert.deepEqual(
    visibleNavItems(false).map((item) => item.href),
    ["/", "/explore", "/scheduled-scans", "/pipeline", "/portals", "/analytics", "/cv", "/documents", "/config"],
  );
});
