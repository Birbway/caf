import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rmSync } from './helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function runDoctor(env, args = []) {
  const result = spawnSync(process.execPath, [join(root, 'doctor.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lanes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dataRoot = join(dir, 'root');
  const lanes = join(dir, 'lanes');
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(lanes);
  const portals = join(lanes, 'portals.yml');
  const pipeline = join(lanes, 'pipeline.md');
  copyFileSync(join(root, 'templates', 'portals.example.yml'), portals);
  writeFileSync(pipeline, '# Pipeline\n\n## Pending\n');
  return {
    dataRoot,
    env: { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PORTALS: portals, CAREER_OPS_PIPELINE: pipeline },
  };
}

test('doctor finds the portals.yml CAREER_OPS_PORTALS names', (t) => {
  const { env } = fixture(t);
  const human = runDoctor(env);
  assert.match(human.stdout, /✓ portals\.yml found/);
  assert.doesNotMatch(human.stdout, /portals\.yml not found/);
  const state = JSON.parse(runDoctor(env, ['--json']).stdout);
  assert.equal(state.missing.includes('portals.yml'), false, JSON.stringify(state.missing));
});

test('doctor does not create a stray data/pipeline.md when CAREER_OPS_PIPELINE is set', (t) => {
  const { dataRoot, env } = fixture(t);
  const human = runDoctor(env);
  assert.match(human.stdout, /✓ data\/pipeline\.md ready/);
  assert.equal(existsSync(join(dataRoot, 'data', 'pipeline.md')), false);
});
