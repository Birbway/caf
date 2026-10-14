// A bare number given to set-status.mjs is a tracker row id. Mode files hand
// the agent a report id, and the two counters diverge as soon as one row has
// no report, so `set-status.mjs <report#> Applied` exits 3 and the agent has
// to retry. Every mode names the selector instead.
//
// Run:  node --test tests/modes-set-status-selector.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function markdownUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownUnder(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

const CALL = /node set-status\.mjs ([^\s`]+)/g;

function bareReportPlaceholders(src) {
  return [...src.matchAll(CALL)].map((m) => m[1]).filter((arg) => arg.startsWith('<report#'));
}

test('mode files never pass a report id as a bare set-status selector', () => {
  const offenders = markdownUnder(join(ROOT, 'modes'))
    .filter((path) => bareReportPlaceholders(readFileSync(path, 'utf-8')).length > 0)
    .map((path) => relative(ROOT, path));
  assert.deepEqual(offenders, []);
});

test('the scan sees the apply-mode calls it guards', () => {
  const src = readFileSync(join(ROOT, 'modes', 'apply.md'), 'utf-8');
  assert.deepEqual([...src.matchAll(CALL)].map((m) => m[1]), ['--report', '--report']);
});

test('a bare report placeholder is reported', () => {
  assert.deepEqual(bareReportPlaceholders('`node set-status.mjs <report#> Applied`'), ['<report#>']);
  assert.deepEqual(bareReportPlaceholders('`node set-status.mjs --report <report#> Applied`'), []);
});
