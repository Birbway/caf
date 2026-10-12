// tests/profile-path-override.test.mjs — CAREER_OPS_PROFILE is honored by every
// reader of config/profile.yml, through one resolver (#5026).
//
// cv-templates.mjs documented the precedence: the override wins over the data
// root. The expression that implements it was then copied by hand into six more
// modules, and most other core readers built the data-root path on their own and
// never looked at the variable. One command could report the same profile as both
// missing and fine (doctor.mjs), and `scan.mjs` followed the named profile while
// the evaluators that ran next read a different one.
//
// Scope: the .mjs modules at the repo root and under lib/, providers/ and scripts/.
// The web app has its own helper and test, and batch/batch-runner.sh and the mode
// prompts that tell an agent to read config/profile.yml are not covered here.
//
// Three layers, because each catches a different way to get this wrong:
//   1. getProfilePath() itself: the precedence, in one place.
//   2. doctor.mjs end to end: the reproduction from the issue, run for real.
//   3. A scan of the tracked sources: a hand-built profile path is the defect
//      class, so a new one fails here instead of surviving until someone notices
//      two files disagree. The PENDING list names modules a later change in this
//      series migrates; an entry that no longer matches is itself a failure, so
//      the list cannot outlive the work it tracks.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { trackedFiles } from '../lib/mjs-files.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\nCAREER_OPS_PROFILE — one resolver for every profile.yml reader (#5026)');

const scratch = mkdtempSync(join(tmpdir(), 'career-ops-profile-override-'));
const dataRoot = join(scratch, 'data-root');
const namedProfile = join(scratch, 'named-profile.yml');
mkdirSync(dataRoot, { recursive: true });
writeFileSync(namedProfile, 'scan:\n  extractor: cli\n', 'utf-8');

const SAVED = {
  CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT,
  CAREER_OPS_DATA_DIR: process.env.CAREER_OPS_DATA_DIR,
  CAREER_OPS_PROFILE: process.env.CAREER_OPS_PROFILE,
};
function restoreEnv() {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

try {
  // ── 1. getProfilePath() ────────────────────────────────────────────────────
  const resolverUrl = pathToFileURL(join(ROOT, 'path-resolver.mjs')).href;
  const { getProfilePath, hasProfileOverride, getCareerOpsRoot } = await import(resolverUrl);

  if (typeof getProfilePath !== 'function') {
    fail('path-resolver.mjs exports no getProfilePath(): there is no single place the override is resolved');
  } else {
    process.env.CAREER_OPS_ROOT = dataRoot;
    process.env.CAREER_OPS_DATA_DIR = '';
    const dataRootProfile = join(getCareerOpsRoot(), 'config', 'profile.yml');

    delete process.env.CAREER_OPS_PROFILE;
    getProfilePath() === dataRootProfile
      ? pass('getProfilePath() is the data root profile when the override is unset')
      : fail(`getProfilePath() with no override gave ${getProfilePath()}, expected ${dataRootProfile}`);

    process.env.CAREER_OPS_PROFILE = namedProfile;
    getProfilePath() === namedProfile
      ? pass('getProfilePath() returns the file CAREER_OPS_PROFILE names')
      : fail(`getProfilePath() ignored the override: got ${getProfilePath()}, expected ${namedProfile}`);

    process.env.CAREER_OPS_PROFILE = `  ${namedProfile}  `;
    getProfilePath() === namedProfile
      ? pass('getProfilePath() trims the override')
      : fail(`getProfilePath() did not trim the override: got ${JSON.stringify(getProfilePath())}`);

    // A relative override resolves against the working directory, as the sibling
    // lane variables (CAREER_OPS_PORTALS, CAREER_OPS_PIPELINE, CAREER_OPS_SCAN_HISTORY)
    // do. docs/SCRIPTS.md sets them together as relative paths.
    const cwdBefore = process.cwd();
    try {
      process.env.CAREER_OPS_PROFILE = 'config/profile.example.yml';
      process.chdir(ROOT);
      const fromRepoRoot = getProfilePath();
      const wantFromRoot = join(process.cwd(), 'config', 'profile.example.yml');
      fromRepoRoot === wantFromRoot
        ? pass('a relative CAREER_OPS_PROFILE resolves against the cwd (repo root)')
        : fail(`relative override from the repo root gave ${fromRepoRoot}, expected ${wantFromRoot}`);
      process.chdir(scratch);
      const fromElsewhere = getProfilePath();
      const wantFromScratch = join(process.cwd(), 'config', 'profile.example.yml');
      fromElsewhere === wantFromScratch
        ? pass('a relative CAREER_OPS_PROFILE follows the cwd when the command runs elsewhere')
        : fail(`relative override from another cwd gave ${fromElsewhere}, expected ${wantFromScratch}`);
    } finally {
      process.chdir(cwdBefore);
    }

    // generate-pdf has to tell "an override is set" from "no override" without
    // comparing paths, since an override may name the data-root profile itself.
    delete process.env.CAREER_OPS_PROFILE;
    const flags = [];
    for (const v of [undefined, '', '   ', dataRootProfile, namedProfile]) {
      if (v === undefined) delete process.env.CAREER_OPS_PROFILE;
      else process.env.CAREER_OPS_PROFILE = v;
      flags.push(hasProfileOverride?.());
    }
    JSON.stringify(flags) === JSON.stringify([false, false, false, true, true])
      ? pass('hasProfileOverride() is true for any non-blank override, including one naming the data-root profile')
      : fail(`hasProfileOverride() gave ${JSON.stringify(flags)}, expected [false,false,false,true,true]`);

    for (const blank of ['', '   ']) {
      process.env.CAREER_OPS_PROFILE = blank;
      getProfilePath() === dataRootProfile
        ? pass(`getProfilePath() treats an override of ${JSON.stringify(blank)} as unset`)
        : fail(`getProfilePath() read an override of ${JSON.stringify(blank)} as a path: got ${getProfilePath()}`);
    }

    // A caller that names its own root has said which workspace it means; the
    // environment must not redirect it (generate-pdf's outputRoot, doctor --target).
    process.env.CAREER_OPS_PROFILE = namedProfile;
    const explicitRoot = join(scratch, 'explicit-root');
    getProfilePath(explicitRoot) === join(explicitRoot, 'config', 'profile.yml')
      ? pass('getProfilePath(root) uses the root the caller named, not the override')
      : fail(`getProfilePath(root) let the override win over an explicit root: got ${getProfilePath(explicitRoot)}`);
  }
  restoreEnv();

  // ── 2. doctor.mjs, the reproduction from the issue ─────────────────────────
  function runDoctor(args, profileEnv) {
    const env = { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' };
    if (profileEnv === undefined) delete env.CAREER_OPS_PROFILE;
    else env.CAREER_OPS_PROFILE = profileEnv;
    const r = spawnSync(NODE, [join(ROOT, 'doctor.mjs'), ...args], { cwd: scratch, encoding: 'utf-8', timeout: 60000, env });
    if (r.error) throw r.error;
    return `${r.stdout}${r.stderr}`;
  }

  const named = runDoctor([], namedProfile);
  !/config\/profile\.yml not found/.test(named)
    ? pass('doctor does not call the profile missing when CAREER_OPS_PROFILE names one that exists')
    : fail('doctor reports config/profile.yml missing although CAREER_OPS_PROFILE names an existing file');
  /Scan extractor: cli/.test(named)
    ? pass('doctor reads scan.extractor from the profile CAREER_OPS_PROFILE names')
    : fail('doctor read scan.extractor from somewhere other than the named profile (expected "Scan extractor: cli")');

  const jsonNamed = JSON.parse(runDoctor(['--json'], namedProfile));
  !jsonNamed.missing.includes('config/profile.yml')
    ? pass('doctor --json does not list the named profile as missing')
    : fail('doctor --json lists config/profile.yml missing although CAREER_OPS_PROFILE names an existing file');

  const absent = join(scratch, 'does-not-exist.yml');
  const absentOut = runDoctor([], absent);
  /config\/profile\.yml not found/.test(absentOut)
    ? pass('doctor still reports the profile missing when the override names a file that is not there')
    : fail('doctor passed the prerequisite although CAREER_OPS_PROFILE names a file that does not exist');
  /CAREER_OPS_PROFILE/.test(absentOut) && absentOut.includes(absent) && !/cp config\/profile\.example\.yml/.test(absentOut)
    ? pass('doctor names CAREER_OPS_PROFILE and the file it points at, instead of advising a copy that would change nothing')
    : fail('doctor advice for a missing override target does not name the variable and path, or still says to copy the example');

  // scan.mjs loads the data root's .env before it reads the profile, so an
  // override set only there is a working setup; doctor has to agree whether or not
  // an unrelated CAREER_OPS_CLI is already exported (that decides if .env loads).
  const envRoot = join(scratch, 'env-root');
  mkdirSync(envRoot, { recursive: true });
  writeFileSync(join(envRoot, '.env'), `CAREER_OPS_PROFILE=${namedProfile}\n`, 'utf-8');
  const runDoctorEnvFile = (args, cli) => {
    const env = { ...process.env, CAREER_OPS_ROOT: envRoot, CAREER_OPS_DATA_DIR: '' };
    delete env.CAREER_OPS_PROFILE;
    if (cli) env.CAREER_OPS_CLI = cli; else delete env.CAREER_OPS_CLI;
    const r = spawnSync(NODE, [join(ROOT, 'doctor.mjs'), ...args], { cwd: scratch, encoding: 'utf-8', timeout: 60000, env });
    if (r.error) throw r.error;
    return `${r.stdout}${r.stderr}`;
  };
  for (const cli of [undefined, 'claude']) {
    const label = cli ? 'with CAREER_OPS_CLI exported' : 'without CAREER_OPS_CLI';
    const human = runDoctorEnvFile([], cli);
    const json = JSON.parse(runDoctorEnvFile(['--json'], cli));
    !/config\/profile\.yml not found/.test(human) && !json.missing.includes('config/profile.yml')
      ? pass(`doctor honors a CAREER_OPS_PROFILE set in the data root .env, human and --json alike (${label})`)
      : fail(`doctor disagrees with itself about a .env-set CAREER_OPS_PROFILE (${label}): human says not found=${/config\/profile\.yml not found/.test(human)}, --json missing=${json.missing.includes('config/profile.yml')}`);
  }

  /config\/profile\.yml not found/.test(runDoctor([], undefined))
    ? pass('doctor reports the profile missing when neither the override nor the data root has one')
    : fail('doctor did not report a missing profile with the override unset');

  // ── 3. no hand-built profile path outside the resolver ─────────────────────
  // web/ resolves its own root and carries its own helper; this scan is the
  // core's. career-profile.mjs reads data/career-profile.yml, a different file.
  const EXEMPT = new Set(['path-resolver.mjs', 'career-profile.mjs']);
  const PENDING = new Set([]);
  const HAND_BUILT = [
    /process\.env\.CAREER_OPS_PROFILE(?!\s*=[^=])/,   // a read; assigning it (doctor.mjs, from .env) is not a path
    /\b(?:join|resolve)\([^\n]*['"](?:config\/)?profile\.yml['"]/,
    /(?<![=!])=\s*['"]config\/profile\.yml['"]/,
    /readFile\(['"]config\/profile\.yml/,
  ];
  const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

  const sources = trackedFiles(ROOT, (f) => f.endsWith('.mjs'))
    .map((abs) => relative(ROOT, abs).split(sep).join('/'))
    .filter((rel) => !/^(tests|templates|web)\//.test(rel) && rel !== 'test-all.mjs' && !/\.test\.mjs$/.test(rel));

  const flagged = new Map();
  for (const rel of sources) {
    const hits = readFileSync(join(ROOT, rel), 'utf-8')
      .split('\n')
      .map((text, i) => ({ n: i + 1, text }))
      .filter(({ text }) => !isComment(text) && HAND_BUILT.some((re) => re.test(text)));
    if (hits.length) flagged.set(rel, hits);
  }

  // Counted so a scan that read nothing cannot pass as a scan that found nothing.
  sources.length > 100
    ? pass(`scanned ${sources.length} tracked core sources for a hand-built profile path`)
    : fail(`profile-path scan read only ${sources.length} sources; the file listing is broken, not the code`);

  const unexpected = [...flagged].filter(([rel]) => !EXEMPT.has(rel) && !PENDING.has(rel));
  unexpected.length === 0
    ? pass('no module outside the pending list builds its own profile.yml path')
    : fail(`profile.yml path built by hand instead of getProfilePath(): ${unexpected
        .map(([rel, hits]) => `${rel}:${hits.map((h) => h.n).join(',')}`).join('; ')}`);

  const stale = [...PENDING].filter((rel) => !flagged.has(rel));
  stale.length === 0
    ? pass('every module on the pending list still builds its own path (the list is current)')
    : fail(`pending list names modules that no longer build a profile path by hand; remove them: ${stale.join(', ')}`);
} finally {
  restoreEnv();
  rmSync(scratch, { recursive: true, force: true });
}
