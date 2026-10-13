import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoleForDedup } from '../scan.mjs';

// German, French and Austrian boards append a gender tag whose letter order
// varies by board, so one posting arrives as several titles.
test('strips a trailing gender tag in any letter order', () => {
  for (const title of [
    'Software Engineer (m/w/d)',
    'Software Engineer (w/m/d)',
    'Software Engineer (f/m/x)',
    'Software Engineer (m/f/d)',
    'Software Engineer (H/F)',
    'Software Engineer (m/w/div)',
    'Software Engineer (all genders)',
    'Software Engineer [m/w/d]',
    'Software Engineer (m/w/d) (Berlin)',
  ]) {
    assert.equal(normalizeRoleForDedup(title), 'software engineer', title);
  }
});

test('keeps a trailing parenthetical that is not a gender tag', () => {
  assert.equal(normalizeRoleForDedup('Software Engineer (ML)'), 'software engineer ml');
  assert.equal(normalizeRoleForDedup('Software Engineer (C/C++)'), 'software engineer c c');
});
