// tests/install-latex-engine.test.mjs -- the opt-in local LaTeX engine
// installer (#5132) and the hint generate-latex.mjs gives when no engine is
// found.
//
// No test here touches the network: fetch and engine detection are injected,
// and the CLI cases exit in validateFlags before any download could start. The
// real download is exercised by hand (`node install-latex-engine.mjs`), not in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TECTONIC_VERSION, TECTONIC_ASSETS, tectonicAsset, verifySha256, installTectonic,
} from '../install-latex-engine.mjs';
import { localTectonicPath } from '../generate-latex.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'install-latex-engine.mjs');

function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT, encoding: 'utf-8', timeout: 30_000, env,
  });
  assert.equal(result.error, undefined, `${script} failed to spawn: ${result.error?.message}`);
  return { ...result, all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => new Uint8Array(Buffer.from(body)).buffer,
    };
  };
  return { impl, calls };
}

test('tectonicAsset maps every supported platform to a pinned release asset', () => {
  const expected = {
    'win32-x64': 'x86_64-pc-windows-msvc.zip',
    'darwin-x64': 'x86_64-apple-darwin.tar.gz',
    'darwin-arm64': 'aarch64-apple-darwin.tar.gz',
    'linux-x64': 'x86_64-unknown-linux-musl.tar.gz',
    'linux-arm64': 'aarch64-unknown-linux-musl.tar.gz',
  };
  for (const [key, suffix] of Object.entries(expected)) {
    const [platform, arch] = key.split('-');
    const asset = tectonicAsset(platform, arch);
    assert.ok(asset, `${key} has no asset`);
    assert.equal(asset.file, `tectonic-${TECTONIC_VERSION}-${suffix}`);
    assert.equal(
      asset.url,
      `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/${asset.file}`,
    );
  }
  assert.deepEqual(Object.keys(TECTONIC_ASSETS).sort(), Object.keys(expected).sort());
});

test('tectonicAsset returns null for a platform with no pinned build', () => {
  assert.equal(tectonicAsset('win32', 'arm64'), null);
  assert.equal(tectonicAsset('freebsd', 'x64'), null);
});

test('every pinned digest is a well-formed SHA-256 and every file carries the pinned version', () => {
  for (const [key, { file, sha256 }] of Object.entries(TECTONIC_ASSETS)) {
    assert.match(sha256, /^[0-9a-f]{64}$/, `${key} digest is malformed`);
    assert.ok(file.includes(`-${TECTONIC_VERSION}-`), `${key} file ${file} is not version ${TECTONIC_VERSION}`);
  }
});

test('verifySha256 accepts a matching buffer and rejects anything else', () => {
  const buf = Buffer.from('tectonic');
  const digest = createHash('sha256').update(buf).digest('hex');
  assert.equal(verifySha256(buf, digest), true);
  assert.equal(verifySha256(buf, digest.toUpperCase()), true);
  assert.equal(verifySha256(Buffer.from('tampered'), digest), false);
  assert.equal(verifySha256(buf, 'not-a-digest'), false);
  assert.equal(verifySha256(buf, undefined), false);
});

test('a download that does not match the pinned digest installs nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'latex-engine-root-'));
  try {
    const { impl, calls } = fakeFetch('definitely not tectonic');
    const result = await installTectonic({
      root, platform: 'linux', arch: 'x64', fetchImpl: impl, detectEngine: () => null,
    });
    assert.equal(result.status, 'checksum-mismatch');
    assert.equal(calls.length, 1);
    assert.deepEqual(readdirSync(root), [], 'something was written to the install root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an HTTP error is reported as a failure, not a crash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'latex-engine-root-'));
  try {
    const { impl } = fakeFetch('', { status: 404 });
    const result = await installTectonic({
      root, platform: 'linux', arch: 'x64', fetchImpl: impl, detectEngine: () => null,
    });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /HTTP 404/);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unsupported platform never downloads and points at manual install', async () => {
  const { impl, calls } = fakeFetch('');
  const result = await installTectonic({
    platform: 'freebsd', arch: 'x64', fetchImpl: impl, detectEngine: () => null,
  });
  assert.equal(result.status, 'unsupported-platform');
  assert.match(result.error, /install tectonic or pdflatex manually/i);
  assert.equal(calls.length, 0);
});

test('an engine that is already available short-circuits without downloading', async () => {
  const { impl, calls } = fakeFetch('');
  const result = await installTectonic({ fetchImpl: impl, detectEngine: () => 'pdflatex' });
  assert.deepEqual(result, { status: 'already-available', engine: 'pdflatex' });
  assert.equal(calls.length, 0);
});

test('--force skips the already-available short-circuit', async () => {
  const { impl, calls } = fakeFetch('x');
  const result = await installTectonic({
    platform: 'linux', arch: 'x64', force: true, fetchImpl: impl,
    detectEngine: () => { throw new Error('detectEngine must not run under --force'); },
  });
  assert.equal(result.status, 'checksum-mismatch');
  assert.equal(calls.length, 1);
});

// A real archive holding a fake binary, served under its own digest, so the
// extract → stage → probe → rename path runs end to end on this host.
function fakeRelease(root) {
  const binName = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
  const src = join(root, 'src');
  mkdirSync(src);
  writeFileSync(join(src, binName), 'new');
  const file = process.platform === 'win32' ? 'fake.zip' : 'fake.tar.gz';
  const archive = join(root, file);
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  const args = process.platform === 'win32' ? ['-a', '-cf', archive, '-C', src, binName] : ['-czf', archive, '-C', src, binName];
  execFileSync(tar, args, { stdio: 'pipe' });
  const buf = readFileSync(archive);
  rmSync(src, { recursive: true, force: true });
  rmSync(archive);
  const asset = { file, url: 'https://example.invalid/fake', sha256: createHash('sha256').update(buf).digest('hex') };
  return { buf, resolveAsset: () => asset };
}

for (const [name, probeResult] of [['a binary that does not run', null], ['a binary that runs', 'tectonic 0.17.0']]) {
  test(`--force with ${name} never leaves the target missing or a .part behind`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'latex-engine-root-'));
    try {
      const { buf, resolveAsset } = fakeRelease(root);
      const target = localTectonicPath(root);
      writeFileSync(target, 'old');
      const probed = [];
      const result = await installTectonic({
        root, force: true, fetchImpl: fakeFetch(buf).impl, resolveAsset,
        probe: (bin) => { probed.push(bin); return probeResult; },
      });
      assert.equal(probed.length, 1);
      assert.notEqual(probed[0], target, 'the probe ran against the live target, not a staged copy');
      assert.equal(result.status, probeResult ? 'installed' : 'failed');
      assert.equal(readFileSync(target, 'utf-8'), probeResult ? 'new' : 'old');
      assert.deepEqual(readdirSync(root), [basename(target)]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('install-latex-engine --help prints usage and exits 0', () => {
  for (const flag of ['--help', '-h']) {
    const result = run(SCRIPT, [flag]);
    assert.equal(result.status, 0, `${flag} exited ${result.status}`);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /node install-latex-engine\.mjs/);
    assert.doesNotMatch(result.all, /Downloading/, `${flag} started a download`);
  }
});

test('install-latex-engine rejects an unrecognized flag before doing anything', () => {
  const result = run(SCRIPT, ['--chekc']);
  assert.equal(result.status, 1);
  assert.match(result.all, /unrecognized flag\(s\): --chekc/i);
  assert.doesNotMatch(result.all, /Downloading/);
});

// Needs a machine with no engine reachable: PATH is narrowed to node's own
// directory, which leaves only the repo-local binary, so skip when one exists.
test('generate-latex reports installHint when no LaTeX engine is found', { skip: existsSync(localTectonicPath()) && 'repo-local tectonic present' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'latex-no-engine-'));
  try {
    const tex = join(dir, 'cv.tex');
    writeFileSync(tex, '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n');
    const env = { ...process.env, PATH: dirname(process.execPath), Path: dirname(process.execPath) };
    const result = run(join(ROOT, 'generate-latex.mjs'), [tex, '--compile-only'], env);
    const report = JSON.parse(result.stdout);
    if (report.engine) return; // a tectonic/pdflatex lives beside node; nothing to assert
    assert.equal(report.compiled, false);
    assert.equal(report.installHint, 'node install-latex-engine.mjs');
    assert.match(report.compileError, /node install-latex-engine.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
