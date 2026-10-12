// tests/web-profile-path-parity.test.mjs — the web's profile.yml path resolver
// (web/src/lib/core/profile-path.mjs) must keep the contract of the core's
// getProfilePath() in path-resolver.mjs (#5026).
//
// The web app cannot import the core helper at build time: Turbopack's root is
// pinned to web/ and refuses modules outside it (see web/next.config.mjs, and
// web/src/lib/profile-keywords.mjs for the same arrangement). So the web carries
// a mirror, and a mirror is what drifts. This guard lives in the ROOT suite, not
// web/tests/, because web-ci.yml runs `npm ci` inside web/ only and is not a
// required check, while test-all.mjs runs on every PR.
//
// The core's getProfilePath() ships in a sibling change and is not imported here;
// the contract is asserted directly instead:
//   - no root argument semantics are the web's "derived data root" case, where
//     the CAREER_OPS_PROFILE override (trimmed; blank counts as unset) wins;
//   - an explicit root names <root>/config/profile.yml and the override does
//     NOT beat it;
//   - the default is <root>/config/profile.yml;
//   - a relative override resolves like core's CAREER_OPS_PORTALS /
//     CAREER_OPS_PIPELINE / CAREER_OPS_SCAN_HISTORY: against the cwd the core CLI
//     runs in. The web's own cwd is web/, one directory too deep, so the web
//     anchors it to the root it passes (the spawned core scripts run with that
//     root as their cwd); an absolute one is unchanged.
// Compare against path-resolver.mjs's getProfilePath when changing either side.
// Unlike core's getProfilePath(rootDir), the web's first argument is the data
// root and the env wins unless explicitRoot is true.

import { pass, fail, ROOT } from './helpers.mjs';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

console.log('\nprofile path — web mirror contract');

const MIRROR = join(ROOT, 'web', 'src', 'lib', 'core', 'profile-path.mjs');

// web/ is not in update-system.mjs's SYSTEM_PATHS, so an install may have no web/
// at all; that absence is real and skipped. A web/ with the mirror missing is a
// move, and a skip there is how a parity guard quietly stops guarding.
if (!existsSync(join(ROOT, 'web'))) {
  pass('profile path parity skipped: no web/ in this checkout');
} else if (!existsSync(MIRROR)) {
  fail('web/src/lib/core/profile-path.mjs is missing; the web has no profile.yml path resolver to check');
} else {
  const { getProfilePath } = await import(pathToFileURL(MIRROR).href);
  const root = resolve('/fixture/data-root');
  const def = join(root, 'config', 'profile.yml');
  const override = resolve('/fixture/elsewhere/me.yml');
  const cases = [
    ['no override resolves <root>/config/profile.yml', getProfilePath(root, { env: {} }), def],
    ['override wins over the derived root', getProfilePath(root, { env: { CAREER_OPS_PROFILE: override } }), override],
    ['override is trimmed', getProfilePath(root, { env: { CAREER_OPS_PROFILE: `  ${override}\n` } }), override],
    ['blank override counts as unset', getProfilePath(root, { env: { CAREER_OPS_PROFILE: ' \t ' } }), def],
    ['relative override resolves against the root the web passes', getProfilePath(root, { env: { CAREER_OPS_PROFILE: 'profiles/me.yml' } }), join(root, 'profiles', 'me.yml')],
    ['absolute override is unchanged', getProfilePath(root, { env: { CAREER_OPS_PROFILE: override } }), override],
    ['explicit root beats the override', getProfilePath(root, { explicitRoot: true, env: { CAREER_OPS_PROFILE: override } }), def],
  ];
  for (const [label, got, want] of cases) {
    if (got === want) pass(label);
    else fail(`${label}: got ${got}, want ${want}`);
  }
}

// ---------------------------------------------------------------------------
// Scan guard: no tracked file under web/src builds the profile path by hand. A
// new site that does is the next one to ignore CAREER_OPS_PROFILE (#5026). This
// is a lexical guard, not proof every reader is covered: comment lines are
// skipped, the helper is exempt, and batch/batch-runner.sh plus the prompts under
// modes/ and batch/ are outside this change.

console.log('\nprofile path — no hand-built path under web/src');

const BY_HAND = [
  /["']config["']\s*,\s*["']profile\.yml["']/,   // path.join(root, "config", "profile.yml")
  /\bloadYaml\(\s*["']config\/profile\.yml["']/, // portals.ts's relative loader
  // A whole-string literal "config/profile.yml" passed to an existence check, a
  // read or a path builder, e.g. existsSync(join(root, "config/profile.yml")) or
  // has("config/profile.yml"). UI labels, prompts and error text are not calls,
  // so they do not match; a literal inside a longer sentence is not whole-string.
  /\b(?:exists\w*|has|statSync|accessSync|readFileSync|readFile|join|resolve)\([^)]*["'`]config\/profile\.yml["'`]/,
  // A direct read of the variable; only the exempt files below may do it.
  /\bprocess\.env\.CAREER_OPS_PROFILE\b/,
  /\benv\.CAREER_OPS_PROFILE\b/,
];
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);
const handBuilt = (line) => !isComment(line) && BY_HAND.some((re) => re.test(line));

// The scan has to be able to find something, or a clean result means nothing.
const probes = [
  ['path.join(root, "config", "profile.yml")', true],
  ['loadYaml("config/profile.yml")', true],
  ['// path.join(root, "config", "profile.yml")', false],
  [' * path.join(root, "config", "profile.yml")', false],
  ['error: "config/profile.yml exists but is not valid YAML"', false],
  ['return fs.existsSync(path.join(root, "config/profile.yml"));', true],
  ['const ok = has("config/profile.yml");', true],
  ['readFileSync(`config/profile.yml`, "utf8")', true],
  ['  "config/profile.yml": "your profile - target roles, comp, location",', false],
  ['["config/profile.yml", "config/profile.yml"],', false],
  ['// existsSync(join(root, "config/profile.yml"))', false],
  ['const p = process.env.CAREER_OPS_PROFILE?.trim();', true],
  ['const p = env.CAREER_OPS_PROFILE;', true],
  ['// reads process.env.CAREER_OPS_PROFILE', false],
];
for (const [line, want] of probes) {
  if (handBuilt(line) === want) pass(`scan classifies: ${line}`);
  else fail(`scan misclassifies (want ${want}): ${line}`);
}

if (existsSync(join(ROOT, 'web', 'src'))) {
  const { execFileSync } = await import('child_process');
  const { readFileSync } = await import('fs');
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', '-z', '--', 'web/src'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
  } catch (err) {
    fail(`could not list tracked web/src files: ${err.message}`);
  }
  // Exemptions, explicit: the helper itself (it is the one reader of the
  // variable), and cv-template.mjs, which must read the variable itself to hand
  // cv-templates.mjs an absolute path (see its header). Nothing else is exempt.
  const EXEMPT = new Set([
    'web/src/lib/core/profile-path.mjs',
    'web/src/lib/core/cv-template.mjs',
  ]);
  const scanned = tracked.filter((f) => !EXEMPT.has(f));
  if (scanned.length > 50) pass(`scanned ${scanned.length} tracked web/src files`);
  else fail(`only ${scanned.length} tracked web/src files scanned; an empty scan cannot pass`);
  const offenders = [];
  for (const f of scanned) {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (handBuilt(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  if (offenders.length === 0) pass('no web/src file builds config/profile.yml by hand');
  else fail(`hand-built config/profile.yml path (route through getProfilePath): ${offenders.join(', ')}`);
}
