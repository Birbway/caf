// tests/profile-path-override-readers.test.mjs — every reader of config/profile.yml
// follows CAREER_OPS_PROFILE, and falls back to the data root, not the cwd (#5026).
//
// tests/profile-path-override.test.mjs pins the resolver and the doctor.mjs
// reproduction. This file runs the REAL modules that used to build the data-root
// path themselves, because "the resolver is correct" says nothing about whether
// each module calls it.
//
// How a module is observed: it runs in a child process with a preload that
// records every profile.yml path the child touches (existsSync / statSync /
// readFileSync / fs.promises, which is how every reader here opens the file).
// The data root holds profile A; CAREER_OPS_PROFILE names profile B; the cwd is
// a third, empty directory. The assertion is on the SET of paths touched:
//   - override set   -> exactly {B}. Any module still on the data-root path adds A.
//   - override unset -> exactly {A}. Any module still on a cwd-relative path
//                       touches the decoy cwd instead of the data root.
// Recording the set, rather than stopping at the first hit, is what catches a
// module that reads the right file at one site and the wrong one at another.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\nCAREER_OPS_PROFILE — every reader follows the override (#5026)');

const failOnce = (msg) => { fail(msg); process.exitCode = 1; };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-profile-readers-')));
const dataRoot = join(scratch, 'data-root');
const decoyCwd = join(scratch, 'decoy-cwd');
const explicitRoot = join(scratch, 'explicit-root');
const profileA = join(dataRoot, 'config', 'profile.yml');
const profileB = join(scratch, 'named-profile-B.yml');
const profileE = join(explicitRoot, 'config', 'profile.yml');

for (const dir of [join(dataRoot, 'config'), join(dataRoot, 'data'), join(dataRoot, 'output'), join(dataRoot, 'modes'),
  decoyCwd, join(explicitRoot, 'config'), join(explicitRoot, 'output')]) {
  mkdirSync(dir, { recursive: true });
}
const profileBody = (tag) => `candidate:\n  full_name: ${tag}\n  email: ${tag.toLowerCase()}@example.com\n` +
  `scan:\n  extractor: cli\ntarget_roles:\n  primary:\n    - ${tag.toLowerCase()}-role\n` +
  'compensation:\n  target_range: "100000"\n';
writeFileSync(profileA, profileBody('Alpha'), 'utf-8');
writeFileSync(profileB, profileBody('Bravo'), 'utf-8');
writeFileSync(profileE, profileBody('Echo'), 'utf-8');
writeFileSync(join(dataRoot, 'cv.md'), '# Alpha Person\n\n## Skills\nNode.js\n', 'utf-8');
writeFileSync(join(dataRoot, 'data', 'applications.md'),
  '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|-------|\n', 'utf-8');
for (const mode of ['_shared.md', '_profile.md', 'oferta.md']) writeFileSync(join(dataRoot, 'modes', mode), '# mode\n', 'utf-8');
writeFileSync(join(dataRoot, 'input.html'), '<html><body><h1>Alpha Person</h1></body></html>', 'utf-8');
writeFileSync(join(dataRoot, 'output', 'applied.pdf'), 'pdf', 'utf-8');
writeFileSync(join(scratch, 'jd.txt'), 'A job description.\n', 'utf-8');
writeFileSync(join(dataRoot, 'batch.json'), JSON.stringify([{ input: 'input.html', output: 'output/batch.pdf' }]), 'utf-8');
writeFileSync(join(scratch, 'payload.json'), JSON.stringify({
  lang: 'en',
  candidate: { name: 'Test Candidate', email: 'test@example.com' },
  summary: 's', competencies: ['Testing'],
  experience: [{ company: 'Test Co', role: 'Engineer', dates: '2026', bullets: ['Built.'] }],
  projects: [], education: [{ title: 'BSc', org: 'U', year: '2025' }],
  certifications: [], skills: [{ category: 'Tools', items: ['Node.js'] }],
}), 'utf-8');

// The preload. Appends one line per profile.yml path a child touches; it never
// changes what the child sees.
const tracer = join(scratch, 'trace-profile-reads.mjs');
writeFileSync(tracer, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const log = process.env.TRACE_LOG;
const append = fs.appendFileSync;
const hit = (p) => {
  if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return;
  const s = String(p);
  if (/(^|[\\\\/])(profile\\.yml|named-profile-B\\.yml)$/.test(s)) append(log, s + '\\n');
};
for (const n of ['readFileSync', 'existsSync', 'statSync', 'openSync', 'accessSync']) {
  const o = fs[n];
  fs[n] = function (p, ...a) { hit(p); return o.call(this, p, ...a); };
}
for (const n of ['readFile', 'access', 'stat']) {
  const o = fs.promises[n];
  fs.promises[n] = function (p, ...a) { hit(p); return o.call(this, p, ...a); };
}
syncBuiltinESMExports();
`, 'utf-8');

// ollama-eval probes /api/tags before it loads any context.
const ollama = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
const ollamaUrl = `http://127.0.0.1:${ollama.address().port}`;

let logCounter = 0;
/**
 * Run a module in a child and return the sorted set of profile paths it touched.
 * @param {string[]} argv node arguments after the preload
 * @param {{override: boolean, cwd?: string}} opts
 */
function touched(argv, { override, cwd = decoyCwd }) {
  const log = join(scratch, `trace-${++logCounter}.log`);
  writeFileSync(log, '');
  const env = {
    ...process.env,
    TRACE_LOG: log,
    CAREER_OPS_ROOT: dataRoot,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_TRACKER: '',
    CAREER_OPS_PROFILE: override ? profileB : '',
    OPENAI_API_KEY: 'unused', GEMINI_API_KEY: 'unused', OPENROUTER_API_KEY: 'unused',
    OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OLLAMA_BASE_URL: ollamaUrl,
  };
  return new Promise((resolveRun) => {
    const child = spawn(NODE, ['--import', pathToFileURL(tracer).href, ...argv], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const paths = [...new Set(readFileSync(log, 'utf-8').split('\n').filter(Boolean))].sort();
      resolveRun({ paths, code, out });
    });
  });
}

const module = (file) => pathToFileURL(join(ROOT, file)).href;
const inline = (code) => ['--input-type=module', '-e', code];
const cli = (file, ...args) => [join(ROOT, file), ...args];

// [class, label, argv]
const SUBJECTS = [
  // 1. evaluators that read the profile into a prompt
  ['evaluators', 'gemini-eval.mjs', cli('gemini-eval.mjs', '--file', join(scratch, 'jd.txt'))],
  ['evaluators', 'ollama-eval.mjs', cli('ollama-eval.mjs', '--file', join(scratch, 'jd.txt'), '--no-save')],
  ['evaluators', 'openai-eval.mjs', cli('openai-eval.mjs', '--file', join(scratch, 'jd.txt'))],
  ['evaluators', 'openai-tailor.mjs', cli('openai-tailor.mjs', '--jd', join(scratch, 'jd.txt'), '--report', join(scratch, 'jd.txt'))],
  ['evaluators', 'batch-evaluate-gemini.mjs', cli('batch-evaluate-gemini.mjs')],
  ['evaluators', 'openrouter-runner.mjs', cli('openrouter-runner.mjs', 'evaluate', 'http://127.0.0.1:9/posting')],
  // 2. pdf / cv builders
  ['builders', 'generate-pdf.mjs (single document)', cli('generate-pdf.mjs', join(dataRoot, 'input.html'), join(dataRoot, 'output', 'single.pdf'))],
  ['builders', 'generate-pdf.mjs (--batch)', cli('generate-pdf.mjs', `--batch=${join(dataRoot, 'batch.json')}`)],
  ['builders', 'build-cv-html.mjs', cli('build-cv-html.mjs', join(scratch, 'payload.json'), join(scratch, 'out.html'))],
  ['builders', 'theme-style.mjs (default arguments)', inline(`const m = await import(${JSON.stringify(module('theme-style.mjs'))}); m.readStyleTokens(); m.readCvSectionOrder();`)],
  ['builders', 'prepare-application.mjs', cli('prepare-application.mjs', '--url', 'https://jobs.lever.co/acme/abc123', '--pdf', join(dataRoot, 'output', 'applied.pdf'))],
  ['builders', 'cv-sync-check.mjs', cli('cv-sync-check.mjs')],
  // 3. analyzers
  ['analyzers', 'salary-gap.mjs', cli('salary-gap.mjs')],
  ['analyzers', 'upskill.mjs', cli('upskill.mjs', '--url-text', join(scratch, 'jd.txt'))],
  ['analyzers', 'check-table-freshness.mjs', cli('check-table-freshness.mjs')],
  // 5. provider / script fallbacks
  ['fallbacks', 'providers/_profile-keywords.mjs', inline(`const m = await import(${JSON.stringify(module('providers/_profile-keywords.mjs'))}); m.resolveProfileKeywords();`)],
  ['fallbacks', 'scripts/export-ats-text.mjs', cli('scripts/export-ats-text.mjs')],
  ['fallbacks', 'browser-extract.mjs (default argument)', inline(`const m = await import(${JSON.stringify(module('browser-extract.mjs'))}); m.resolveExtractorMode();`)],
];

try {
  for (const [group, label, argv] of SUBJECTS) {
    const named = await touched(argv, { override: true });
    named.paths.length === 1 && named.paths[0] === profileB
      ? pass(`${group}: ${label} reads the profile CAREER_OPS_PROFILE names, and only that one`)
      : failOnce(`${group}: ${label} touched ${JSON.stringify(named.paths.map((p) => p.replace(scratch, '<scratch>')))} with the override set; expected only <scratch>/named-profile-B.yml (exit ${named.code})`);

    const fallback = await touched(argv, { override: false });
    fallback.paths.length === 1 && fallback.paths[0] === profileA
      ? pass(`${group}: ${label} falls back to the data root profile when the override is unset`)
      : failOnce(`${group}: ${label} touched ${JSON.stringify(fallback.paths.map((p) => p.replace(scratch, '<scratch>')))} with the override unset; expected only <scratch>/data-root/config/profile.yml (exit ${fallback.code})`);
  }

  // generate-pdf's renderHtmlToPdf: a caller that names its own workspace has said
  // which profile it means, so the override does not redirect it; a caller that
  // names none renders in the default workspace, where the override applies.
  const render = (workspaceRootArg) => inline(`
    const { renderHtmlToPdf } = await import(${JSON.stringify(module('generate-pdf.mjs'))});
    await renderHtmlToPdf('<html><body><h1>Probe</h1></body></html>', ${JSON.stringify(join(workspaceRootArg ?? dataRoot, 'output', 'render-probe.pdf'))},
      ${workspaceRootArg ? `{ workspaceRoot: ${JSON.stringify(workspaceRootArg)} }` : '{}'});
  `);
  const explicit = await touched(render(explicitRoot), { override: true });
  explicit.paths.length === 1 && explicit.paths[0] === profileE
    ? pass('builders: renderHtmlToPdf with an explicit workspaceRoot reads that workspace profile, not the override')
    : failOnce(`builders: renderHtmlToPdf({workspaceRoot}) touched ${JSON.stringify(explicit.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/explicit-root/config/profile.yml (exit ${explicit.code})`);
  const defaulted = await touched(render(null), { override: true });
  defaulted.paths.length === 1 && defaulted.paths[0] === profileB
    ? pass('builders: renderHtmlToPdf with no workspaceRoot reads the profile CAREER_OPS_PROFILE names')
    : failOnce(`builders: renderHtmlToPdf() touched ${JSON.stringify(defaulted.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/named-profile-B.yml (exit ${defaulted.code})`);

  // 4. update-system: the template variants the updater preserves are the ones the
  // profile in force selects. snapshotConfiguredTemplateVariants() takes a data
  // root (tests and apply() both pass one) and an optional profilePath that names
  // the file outright.
  const snapshot = (profilePathArg) => inline(`
    const { snapshotConfiguredTemplateVariants } = await import(${JSON.stringify(module('update-system.mjs'))});
    await snapshotConfiguredTemplateVariants({ dataRoot: ${JSON.stringify(dataRoot)}${profilePathArg ? `, profilePath: ${JSON.stringify(profilePathArg)}` : ''} });
  `);
  const fromRoot = await touched(snapshot(null), { override: true });
  fromRoot.paths.length === 1 && fromRoot.paths[0] === profileA
    ? pass('updater: snapshotConfiguredTemplateVariants({dataRoot}) reads that root, not the override')
    : failOnce(`updater: snapshot with an explicit dataRoot touched ${JSON.stringify(fromRoot.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/data-root/config/profile.yml (exit ${fromRoot.code})`);
  const named = await touched(snapshot(profileB), { override: false });
  named.paths.length === 1 && named.paths[0] === profileB
    ? pass('updater: snapshotConfiguredTemplateVariants({profilePath}) reads the profile it is given')
    : failOnce(`updater: snapshot with a profilePath touched ${JSON.stringify(named.paths.map((p) => p.replace(scratch, '<scratch>')))}; expected only <scratch>/named-profile-B.yml (exit ${named.code})`);
} catch (e) {
  failOnce(`profile-path readers suite crashed: ${e.stack || e.message}`);
} finally {
  ollama.close();
  rmSync(scratch, { recursive: true, force: true });
}
