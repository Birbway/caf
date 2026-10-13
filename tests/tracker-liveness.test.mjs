import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { trackerLivenessTargets, reportPostingUrl } from '../lib/tracker-liveness.mjs';

const tracker = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-09-01 | Initech | Engineer | 4.0/5 | Evaluated | ❌ | — | no link |',
  '| 2 | 2026-09-02 | Globex | Staff Engineer | 4.2/5 | Applied | ✅ | [2](../reports/002-globex-2026-09-02.md) | |',
  '| 3 | 2026-09-03 | Acme | Platform Engineer | 4.1/5 | evaluated | ❌ | [3](../reports/003-acme-2026-09-03.md) | |',
  '| 4 | 2026-09-04 | Hooli | Engineer | 3.0/5 | SKIP | ❌ | [4](../reports/004-hooli-2026-09-04.md) | |',
  '| 5 | 2026-09-05 | Acme | Platform Engineer | 4.1/5 | Evaluated | ❌ | [5](../reports/005-acme-2026-09-05.md) | repost |',
].join('\n');
const reports = {
  2: '**URL:** https://jobs.example.test/globex/2',
  3: '**Score:** 4.1/5 | **URL:** <https://jobs.example.test/acme/3>, | **PDF:** -',
  4: '**URL:** https://jobs.example.test/hooli/4',
  5: '**URL:** https://jobs.example.test/acme/3',
};

test('open tracker rows resolve to their report posting URL, once per URL', () => {
  const { targets, noUrl } = trackerLivenessTargets(tracker, { readReport: (n) => reports[n] ?? null });
  assert.deepEqual(targets, [
    { num: 2, company: 'Globex', role: 'Staff Engineer', status: 'Applied', url: 'https://jobs.example.test/globex/2' },
    { num: 3, company: 'Acme', role: 'Platform Engineer', status: 'evaluated', url: 'https://jobs.example.test/acme/3' },
  ]);
  assert.deepEqual(noUrl, [1]);
});

test('--status picks which rows are swept', () => {
  const { targets } = trackerLivenessTargets(tracker, { statuses: ['SKIP'], readReport: (n) => reports[n] ?? null });
  assert.deepEqual(targets.map((t) => t.num), [4]);
});

test('a report URL that is not http stays unknown', () => {
  assert.equal(reportPostingUrl('**URL:** N/A'), '');
  assert.equal(reportPostingUrl('no header'), '');
});

test('--tracker without a tracker file says so and exits 1', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'liveness-tracker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(ROOT, 'check-liveness.mjs'), '--tracker', '--no-record'], {
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root }, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /No tracker at /);
  assert.doesNotMatch(result.stderr, /Usage:/);
});
