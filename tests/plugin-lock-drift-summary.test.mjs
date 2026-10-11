// tests/plugin-lock-drift-summary.test.mjs — the drift warning for a local
// plugin must say what kind of change it saw (#5027).
//
// plugins.local/ exists so a developer can link a plugin's own checkout in and
// work on it there (#3140). A working checkout collects files that are not
// plugin source: git worktrees, tool logs. hashPluginTree hashes every one of
// them on purpose, because a plugin can import() any file under its directory,
// so a worktree edit or a new log line is real drift as far as the lock can
// tell. lockGate then skips the plugin with a tamper warning.
//
// The warning used to print the first five changed paths in sorted order, with
// no total and no split between modified, added and removed files. A real edit
// to index.mjs sat among whatever sorted ahead of it. The hash stays total; the
// message now explains the drift instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const lock = await import(pathToFileURL(join(ROOT, 'plugins/_lock.mjs')).href);
const engine = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);

const manifestFor = (dir, version = '1.0.0') => ({
  id: 'lp', version, dir, hooks: [], requiredEnv: [], allowedHosts: [],
});

const put = (dir, rel, text = 'x\n') => {
  const abs = join(dir, ...rel.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
};

/** A pinned local plugin: <root>/plugins.local/lp with index.mjs and a lock entry. */
function pinnedPlugin() {
  const root = mkdtempSync(join(tmpdir(), 'co-drift-'));
  const dir = join(root, 'plugins.local', 'lp');
  put(dir, 'index.mjs', 'export default {};\n');
  put(dir, 'lib/util.mjs', 'export const a = 1;\n');
  const man = manifestFor(dir);
  const tree = lock.hashPluginTree(dir);
  const entry = {
    source: 'local', version: man.version,
    integrity: tree.integrity, files: tree.files, consent: lock.consentSurface(man),
  };
  lock.writeLockEntry(root, 'lp', entry);
  return { root, dir, man, entry };
}

/** Run lockGate and return its result plus every warning it printed. */
function gate(man, root) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    return { result: engine.lockGate(man, root), warnings };
  } finally {
    console.warn = original;
  }
}

test('diffPlugin splits the drift into modified, added and removed paths', () => {
  const { root, dir, man, entry } = pinnedPlugin();
  try {
    put(dir, 'index.mjs', 'export default { edited: 1 };\n');
    rmSync(join(dir, 'lib', 'util.mjs'));
    put(dir, 'worktrees/w1/a.mjs');
    put(dir, 'logs/run.log');
    const d = lock.diffPlugin(man, entry);
    assert.equal(d.status, 'drift-nobump');
    assert.deepEqual(d.modified, ['index.mjs']);
    assert.deepEqual(d.removed, ['lib/util.mjs']);
    assert.deepEqual(d.added, ['logs/run.log', 'worktrees/w1/a.mjs']);
    assert.deepEqual(
      [...d.changedFiles].sort(),
      ['index.mjs', 'lib/util.mjs', 'logs/run.log', 'worktrees/w1/a.mjs'],
      'changedFiles keeps its meaning: the union of all three',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unchanged plugin reports no drift paths', () => {
  const { root, man, entry } = pinnedPlugin();
  try {
    const d = lock.diffPlugin(man, entry);
    assert.equal(d.status, 'match');
    assert.deepEqual([d.modified, d.added, d.removed], [[], [], []]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('describeDrift counts each kind and groups added paths by top-level directory', () => {
  const text = lock.describeDrift({
    modified: ['index.mjs'],
    removed: [],
    added: [
      'logs/run.log',
      ...Array.from({ length: 6 }, (_, i) => `worktrees/dev-1-x/f${i}.mjs`),
    ],
  });
  assert.match(text, /1 modified: index\.mjs/);
  assert.match(text, /7 added: worktrees\/ \(6\), logs\/ \(1\)/);
  assert.doesNotMatch(text, /removed/, 'a kind with no paths is left out');
  assert.doesNotMatch(text, /f0\.mjs/, 'added files are summarized, not listed one by one');
});

test('describeDrift lists modified paths before added ones, whatever they sort to', () => {
  const text = lock.describeDrift({
    modified: ['index.mjs'],
    removed: ['lib/gone.mjs'],
    added: Array.from({ length: 31 }, (_, i) => `.remember/logs/save-${i}.log`),
  });
  assert.ok(text.indexOf('index.mjs') < text.indexOf('.remember/'), 'the real edit leads the message');
  assert.ok(text.indexOf('lib/gone.mjs') < text.indexOf('.remember/'));
  assert.match(text, /31 added: \.remember\/ \(31\)/);
});

test('describeDrift names a root-level added file itself and caps long lists', () => {
  const text = lock.describeDrift({
    modified: Array.from({ length: 8 }, (_, i) => `m${i}.mjs`),
    removed: [],
    added: ['new.mjs', 'a/1', 'b/1', 'c/1', 'd/1', 'e/1', 'f/1'],
  });
  assert.match(text, /8 modified: m0\.mjs, m1\.mjs, m2\.mjs, m3\.mjs, m4\.mjs and 3 more/);
  assert.match(text, /7 added: .* and 2 more/);
  assert.match(text, /\bnew\.mjs\b/, 'a file at the plugin root is its own group');
});

test('lockGate still blocks a drifted local plugin, and the warning explains the drift', () => {
  const { root, dir, man } = pinnedPlugin();
  try {
    put(dir, 'index.mjs', 'export default { edited: 1 };\n');
    for (let i = 0; i < 6; i++) put(dir, `worktrees/dev-1-x/f${i}.mjs`);
    put(dir, 'logs/run.log');
    const { result, warnings } = gate(man, root);
    assert.equal(result.load, false, 'the hash and the decision to skip are unchanged');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /possible tampering/);
    assert.match(warnings[0], /1 modified: index\.mjs/);
    assert.match(warnings[0], /7 added: worktrees\/ \(6\), logs\/ \(1\)/);
    assert.match(warnings[0], /node plugins\.mjs trust lp/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the hash stays total: a directory with a .git file is not skipped', () => {
  // Negative control for the decision recorded in tests/mjs-files.test.mjs: a
  // marker-based skip would let code park where the hash cannot see it.
  const { root, dir, man } = pinnedPlugin();
  try {
    put(dir, 'nested/.git', 'gitdir: /somewhere/else\n');
    put(dir, 'nested/code.mjs', 'export default 1;\n');
    const { result, warnings } = gate(man, root);
    assert.equal(result.load, false, 'a file added beside a .git marker is still drift');
    assert.match(warnings[0], /nested\/ \(/, 'the nested files are counted, not hidden');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an untouched local plugin loads without a warning', () => {
  const { root, man } = pinnedPlugin();
  try {
    const { result, warnings } = gate(man, root);
    assert.equal(result.load, true);
    assert.deepEqual(warnings, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
