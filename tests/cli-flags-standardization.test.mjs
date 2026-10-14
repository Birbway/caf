// tests/cli-flags-standardization.test.mjs — validateFlags() adoption across
// find.mjs, jd-similarity.mjs, and application-answers.mjs (#5181).
//
// Replaces hand-written unknown-flag checks with validateFlags() from
// lib/cli-flags.mjs.
// Two visible effects pinned here:
//   1. `--help --bogus` fails fast (exit 1) rather than exiting 0 on --help.
//   2. `--report=value` in application-answers.mjs is correctly parsed rather
//      than misread.

import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';

console.log('\ncli-flags-standardization — validateFlags adoption in find, jd-similarity, and application-answers (#5181)');

function runCli(script, args) {
  return spawnSync(NODE, [join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
}

// ── 1. find.mjs ─────────────────────────────────────────────────────────────
{
  const rHelp = runCli('find.mjs', ['--help']);
  if (rHelp.status === 0 && rHelp.stdout.includes('Usage:')) {
    pass('find.mjs: --help prints usage and exits 0');
  } else {
    fail(`find.mjs: --help failed: status=${rHelp.status} stdout=${rHelp.stdout} stderr=${rHelp.stderr}`);
  }

  const rShortHelp = runCli('find.mjs', ['-h']);
  if (rShortHelp.status === 0 && rShortHelp.stdout.includes('Usage:')) {
    pass('find.mjs: -h prints usage and exits 0');
  } else {
    fail(`find.mjs: -h failed: status=${rShortHelp.status} stdout=${rShortHelp.stdout} stderr=${rShortHelp.stderr}`);
  }

  const rBogus = runCli('find.mjs', ['--bogus']);
  if (rBogus.status === 1 && /unrecognized flag\(s\): --bogus/.test(rBogus.stderr)) {
    pass('find.mjs: unrecognized flag exits 1');
  } else {
    fail(`find.mjs: --bogus failed: status=${rBogus.status} stderr=${rBogus.stderr}`);
  }

  const rHelpBogus = runCli('find.mjs', ['--help', '--bogus']);
  if (rHelpBogus.status === 1 && /unrecognized flag\(s\): --bogus/.test(rHelpBogus.stderr)) {
    pass('find.mjs: --help --bogus exits 1 on unrecognized flag before --help');
  } else {
    fail(`find.mjs: --help --bogus failed: status=${rHelpBogus.status} stdout=${rHelpBogus.stdout} stderr=${rHelpBogus.stderr}`);
  }
}

// ── 2. jd-similarity.mjs ────────────────────────────────────────────────────
{
  const rHelp = runCli('jd-similarity.mjs', ['--help']);
  if (rHelp.status === 0 && rHelp.stdout.includes('Usage:')) {
    pass('jd-similarity.mjs: --help prints usage and exits 0');
  } else {
    fail(`jd-similarity.mjs: --help failed: status=${rHelp.status} stdout=${rHelp.stdout} stderr=${rHelp.stderr}`);
  }

  const rShortHelp = runCli('jd-similarity.mjs', ['-h']);
  if (rShortHelp.status === 0 && rShortHelp.stdout.includes('Usage:')) {
    pass('jd-similarity.mjs: -h prints usage and exits 0');
  } else {
    fail(`jd-similarity.mjs: -h failed: status=${rShortHelp.status} stdout=${rShortHelp.stdout} stderr=${rShortHelp.stderr}`);
  }

  const rBogus = runCli('jd-similarity.mjs', ['--bogus']);
  if (rBogus.status === 1 && /unrecognized flag\(s\): --bogus/.test(rBogus.stderr)) {
    pass('jd-similarity.mjs: unrecognized flag exits 1');
  } else {
    fail(`jd-similarity.mjs: --bogus failed: status=${rBogus.status} stderr=${rBogus.stderr}`);
  }

  const rHelpBogus = runCli('jd-similarity.mjs', ['--help', '--bogus']);
  if (rHelpBogus.status === 1 && /unrecognized flag\(s\): --bogus/.test(rHelpBogus.stderr)) {
    pass('jd-similarity.mjs: --help --bogus exits 1 on unrecognized flag before --help');
  } else {
    fail(`jd-similarity.mjs: --help --bogus failed: status=${rHelpBogus.status} stdout=${rHelpBogus.stdout} stderr=${rHelpBogus.stderr}`);
  }
}

// ── 3. application-answers.mjs ──────────────────────────────────────────────
{
  const rHelp = runCli('application-answers.mjs', ['--help']);
  if (rHelp.status === 0 && rHelp.stdout.includes('Usage:')) {
    pass('application-answers.mjs: --help prints usage and exits 0');
  } else {
    fail(`application-answers.mjs: --help failed: status=${rHelp.status} stdout=${rHelp.stdout} stderr=${rHelp.stderr}`);
  }

  const rShortHelp = runCli('application-answers.mjs', ['-h']);
  if (rShortHelp.status === 0 && rShortHelp.stdout.includes('Usage:')) {
    pass('application-answers.mjs: -h prints usage and exits 0');
  } else {
    fail(`application-answers.mjs: -h failed: status=${rShortHelp.status} stdout=${rShortHelp.stdout} stderr=${rShortHelp.stderr}`);
  }

  const rBogus = runCli('application-answers.mjs', ['--bogus']);
  if (rBogus.status === 1 && /unrecognized flag\(s\): --bogus/.test(rBogus.stderr)) {
    pass('application-answers.mjs: unrecognized flag exits 1');
  } else {
    fail(`application-answers.mjs: --bogus failed: status=${rBogus.status} stderr=${rBogus.stderr}`);
  }

  const rHelpBogus = runCli('application-answers.mjs', ['--help', '--bogus']);
  if (rHelpBogus.status === 1 && /unrecognized flag\(s\): --bogus/.test(rHelpBogus.stderr)) {
    pass('application-answers.mjs: --help --bogus exits 1 on unrecognized flag before --help');
  } else {
    fail(`application-answers.mjs: --help --bogus failed: status=${rHelpBogus.status} stdout=${rHelpBogus.stdout} stderr=${rHelpBogus.stderr}`);
  }

  const rMissingOperand = runCli('application-answers.mjs', ['--report']);
  if (rMissingOperand.status === 1 && /--report requires a value/.test(rMissingOperand.stderr)) {
    pass('application-answers.mjs: missing operand for value flag exits 1');
  } else {
    fail(`application-answers.mjs: missing operand failed: status=${rMissingOperand.status} stderr=${rMissingOperand.stderr}`);
  }

  // Pinned bug fix: --report=path was previously misread by hand-written arg parser
  const rEqualsForm = runCli('application-answers.mjs', ['--report=nonexistent-test-report.md', '--read']);
  // With --report=nonexistent-test-report.md parsed properly, it reaches readFileSync(resolve('nonexistent-test-report.md'))
  // which fails with ENOENT in main(), rather than throwing "Missing value for --report=..." or printing usage.
  if (rEqualsForm.status === 1 && /ENOENT|no such file/i.test(rEqualsForm.stderr)) {
    pass('application-answers.mjs: --report=value form is correctly parsed');
  } else {
    fail(`application-answers.mjs: --report=value failed: status=${rEqualsForm.status} stderr=${rEqualsForm.stderr}`);
  }
}
