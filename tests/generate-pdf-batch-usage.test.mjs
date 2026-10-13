// tests/generate-pdf-batch-usage.test.mjs: the usage text says where relative
// --batch manifest paths resolve, since it is the manifest folder, not the cwd.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'generate-pdf.mjs');

try {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Relative input and output paths in the manifest resolve against the\nmanifest's own folder, not the current directory\./);
  pass('usage names the manifest folder as the base for relative batch paths');
} catch (e) {
  fail(`usage names the manifest folder as the base for relative batch paths — ${e.message}`);
}
