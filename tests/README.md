# tests/

Auto-discovered test files for the career-ops suite.

## Purpose

`test-all.mjs` (repo root) is the suite runner: it executes its inline core
checks (syntax, scripts, dashboard, data contract, personal data, paths) and
then auto-discovers every `*.test.mjs` file under this directory. There is no
test framework by design — the suite must run on a fresh clone with only
Node.js (`tests/helpers.mjs`).

## Layout

- `helpers.mjs` — shared assertion helpers and counters. Exports `pass`,
  `fail`, `warn`, plus `ROOT` (repo root), `QUICK` (`--quick` flag), and
  `NODE` (current Node binary).
- `providers/{name}.test.mjs` — one file per scanner provider (see
  [providers/ADDING_A_PROVIDER.md](../providers/ADDING_A_PROVIDER.md) for the
  test pattern), plus shared cross-provider tests such as
  `ats-ssrf-hardening.test.mjs`.
  Underscore-prefixed files (e.g. `_html-entities.test.mjs`) test shared
  helper modules.
- Other `*.test.mjs` files at this level (e.g. `stats.test.mjs`) cover root
  scripts. Note: standalone `*.test.mjs` files in the repo root are not
  discovered and will not run — `tests/no-root-suites.test.mjs` fails the
  build if one shows up (see "Why the flat root" in ARCHITECTURE.md).
  A handful of `*-tests.mjs` suites do remain at the root (a flag-driven CI
  harness, a suite that asserts on its own filename, two needing a per-script
  timeout, and one added after the convention was written); those are registered in
  `test-all.mjs`'s `scripts` list or invoked by a workflow, and
  `root-tests-registration.test.mjs` asserts every one of them is reachable.

**Web tests do not live here.** `web/` runs its own `npm test` over
`web/tests/**/*.test.mjs` (see [../web/README.md](../web/README.md)); this
directory is for the core. The two suites also differ in style on purpose: web
suites use `node:test`, while suites here use the `pass`/`fail` helpers because
this suite must run on a bare clone with no framework — "not even `node:test`"
(#1440). Don't carry either style across the boundary.

The one exception to the split is a guard *about* web's layout —
`web-test-layout.test.mjs` lives here on purpose, because `web-ci.yml` is
informative by design and never blocks a merge, while `test-all.mjs` runs on
every PR as a required check.

## Running

```bash
node test-all.mjs                            # full suite — run before pushing
node test-all.mjs --quick                    # full suite, skip dashboard build
node test-all.mjs --only providers/themuse   # only matching tests/ files
```

Discovery walks `tests/` recursively, sorted lexicographically for a
deterministic cross-OS order. `--only` filters on the tests-relative path and
exits 1 when nothing matches (so a typo cannot turn CI green).

**`--only` is a dev convenience, not a PR gate:** it skips every inline core
section of `test-all.mjs`. A green `--only` run is not a green suite — always
run the full `node test-all.mjs` before pushing.

## Adding a test

Add one `{name}.test.mjs` file here — it is auto-discovered, no registration
needed. Do not add a section to `test-all.mjs`. Import the helpers with a
path relative to the test file's location:

```js
import { pass, fail, ROOT } from './helpers.mjs';    // tests/*.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';   // tests/providers/*.test.mjs
```

See `CONTRIBUTING.md` for the full contribution flow.

## The suite's data root

The suite is run inside real workspaces, so it never reads or writes the
developer's data. When `helpers.mjs` loads it creates a scratch directory, pins
`CAREER_OPS_ROOT` to it (clearing `CAREER_OPS_DATA_DIR`, as it clears
`CAREER_OPS_TRACKER`), and removes it at exit. Every script a test spawns
inherits that, so the default for a new test is already safe.

- **A test that needs data** writes it under a `mkdtemp` directory and passes
  that directory to the child: `env: { ...process.env, CAREER_OPS_ROOT: dir,
  CAREER_OPS_DATA_DIR: '' }`. Never write a fixture over a file under `ROOT`
  and put the original back afterwards — an interrupted run does not reach the
  `finally`, and `data/` is not in git.
- **A test that copies scripts into a temp directory** and expects the copy to
  be its own data root spawns it with `env: ownRootEnv()`.
- **A test that must change the variable in-process** calls
  `pinSandboxDataRoot()` when it is done, rather than `delete`.
- `SANDBOX_DATA_ROOT` is the scratch root, for a fixture that has to sit under
  the data root's `output/` or `jds/`.

`data-root-guard.mjs` fingerprints the real user layer before the run and at
exit — including an exit by Ctrl-C — and fails the run, naming each path, if
anything differs.
