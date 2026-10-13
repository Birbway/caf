// tests/check-jd-archive-paraphrase.test.mjs - a report whose "## Job Description"
// section admits it is a paraphrase is flagged, with the reason named, unless a
// jds/ capture backs it (#5179).
//
// Run:  node --test tests/check-jd-archive-paraphrase.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkJdArchive } from '../check-jd-archive.mjs';

const PARAPHRASE_REPORT = [
  '# Evaluation: Acme - Director of Marketing',
  '',
  '## Job Description (archived verbatim)',
  '',
  'Note: the fetch tool would not return the literal text. What follows is a close paraphrase, not a literal copy.',
  '',
  'Title: Director of Marketing. Owns demand generation, reports to the CMO, manages a team of eight.',
  '',
  '## Machine Summary',
  '',
].join('\n');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'jd-paraphrase-'));
  const reportsDir = join(dir, 'reports');
  const jdsDir = join(dir, 'jds');
  mkdirSync(reportsDir);
  mkdirSync(jdsDir);
  writeFileSync(join(reportsDir, '042-acme-2026-01-15.md'), PARAPHRASE_REPORT);
  return { dir, reportsDir, jdsDir };
}

test('a self-declared paraphrase under a verbatim heading is flagged, naming the reason', () => {
  const { dir, reportsDir, jdsDir } = fixture();
  try {
    const { findings } = checkJdArchive(reportsDir, jdsDir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, 'missing-jd-archive');
    assert.match(findings[0].detail, /says it is a paraphrase or restatement/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the same report passes once a report-numbered jds/ capture exists', () => {
  const { dir, reportsDir, jdsDir } = fixture();
  try {
    writeFileSync(join(jdsDir, '042-2026-01-15_acme_director-of-marketing.md'), 'captured posting text');
    const { findings } = checkJdArchive(reportsDir, jdsDir);
    assert.deepEqual(findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
