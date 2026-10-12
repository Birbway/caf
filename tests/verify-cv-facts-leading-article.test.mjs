import { pass, fail } from './helpers.mjs';
import { factClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nA tool named after a leading "a" or "an"');

// The tool gate is fail-closed: a name the sources never mention blocks the
// render. A piece led by "a" or "an" used to be dropped by the prose-word
// check, so "using a Kubernetes cluster" was never compared with cv.md and a
// fabricated name passed. The name after the article is the claim to check,
// alone: "Kubernetes", not "Kubernetes cluster", so a source that says only
// "Kubernetes" backs it. The determiners of #4004 ("the", "our", "their")
// still mark ordinary reference and are not read.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-leading-article-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));

  const check = (cv, target) => {
    writeFileSync(source, `${cv}\n`);
    return verifyFacts(target, { sourcePaths: [source], configPath: config });
  };
  const tools = result => result.unsupportedFacts.filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const blocksOn = (label, cv, target, expected) => {
    const result = check(cv, target);
    const found = tools(result);
    if (result.verdict === 'block' && JSON.stringify(found) === JSON.stringify(expected)) pass(label);
    else fail(`${label}: expected a block on exactly ${JSON.stringify(expected)}, got ${result.verdict} ${JSON.stringify(found)}`);
  };
  const passes = (label, cv, target) => {
    const result = check(cv, target);
    if (result.verdict === 'pass' && result.unsupportedFacts.length === 0) pass(label);
    else fail(`${label}: expected a clean pass, got ${result.verdict} ${JSON.stringify(result.unsupportedFacts)}`);
  };
  const toolValues = text => factClaims(text).filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const sameTools = (label, text, expected) => {
    const found = toolValues(text);
    if (JSON.stringify(found) === JSON.stringify(expected)) pass(label);
    else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(found)}`);
  };

  const reactOnly = '- Built the platform using React.';

  // The reproduction from the issue. The first line is the control: the same
  // unbacked name blocks when no article comes before it. A dotted name is
  // read by two captures, the one that stops at the dot and the one that
  // reads through it, so the control for those two shows both.
  blocksOn('the control, a name with no article, is checked',
    reactOnly, '- Built the platform using Kubernetes.', ['kubernetes']);
  blocksOn('a name after "a" is checked',
    reactOnly, '- Built the platform using a Kubernetes cluster.', ['kubernetes']);
  blocksOn('a name after "an" is checked',
    reactOnly, '- Built the platform using an Elasticsearch index.', ['elasticsearch']);
  blocksOn('a dotted name after "an" in a later list item is checked',
    reactOnly, '- Built the platform using React and an ASP.NET backend.', ['asp', 'asp.net']);
  blocksOn('a dotted name after "a" is checked',
    reactOnly, '- Rebuilt the storefront using a Next.js app.', ['next', 'next.js']);

  // The class is every list item behind an article, whatever the trigger.
  blocksOn('a name after "a" in the middle of a list is checked',
    reactOnly, '- Built the platform using React, a Kubernetes cluster and Docker.', ['kubernetes', 'docker']);
  blocksOn('a name after "an" behind "worked with" is checked',
    reactOnly, '- Worked with an Elasticsearch team.', ['elasticsearch']);
  blocksOn('a name after "an" in a declared list is checked',
    reactOnly, 'Technologies: React, an Elasticsearch index', ['elasticsearch']);
  blocksOn('a name after "an" behind a later "using" is checked',
    reactOnly, '- Built the platform using React, using an Elasticsearch.', ['elasticsearch']);
  blocksOn('a name after a capitalised "A" is checked',
    reactOnly, '- Built the platform using A Kubernetes cluster.', ['kubernetes']);
  blocksOn('a name after "an" in a bracketed list is checked',
    reactOnly, '- Built the platform using React (an Elasticsearch index).', ['elasticsearch']);

  // After the article the name is checked alone. The words that follow it
  // belong to the noun the article opened, not to the name.
  passes('a name after "a" that the source backs passes',
    '- Ran workloads on Kubernetes.', '- Built the platform using a Kubernetes cluster.');
  passes('a backed name after "an" in a later list item passes',
    '- Built it using React and ASP.NET.', '- Built the platform using React and an ASP.NET backend.');
  passes('a backed dotted name after "a" passes',
    '- Shipped it using Next.js.', '- Rebuilt the storefront using a Next.js app.');
  passes('a backed name with a digit after "an" passes',
    '- Stored exports in S3.', '- Stored the exports using an S3 bucket.');
  blocksOn('a name with a digit after "an" is checked as the name',
    reactOnly, '- Stored the exports using an S3 bucket.', ['s3']);
  sameTools('a name after "a" is read without the noun behind it',
    'Built the platform using a Kubernetes cluster.', ['kubernetes']);
  sameTools('a name after "an" is read without the noun behind it',
    'Built the platform using an Elasticsearch index.', ['elasticsearch']);
  sameTools('every name in a clause behind an article is read on its own',
    'Built the platform using a Kubernetes cluster on AWS across three regions.', ['kubernetes', 'aws']);

  // Ordinary prose behind an article is not a tool.
  passes('an article before lowercase prose is not a tool',
    reactOnly, '- Built the platform using a small team.');
  passes('an article before lowercase prose behind "worked with" is not a tool',
    reactOnly, '- Worked with an outside agency on the launch.');
  passes('an article before a lowercase clause in a list is not a tool',
    reactOnly, '- Built the platform using React and a custom internal workflow.');
  passes('a capitalised article before lowercase prose is not a tool',
    reactOnly, '- Built the platform using An outside agency.');
  passes('a dotted abbreviation after an article is not a name',
    reactOnly, '- Built the platform using a U.S. team.');
  passes('a lone letter after an article is not a name',
    reactOnly, '- Built the platform using React and a B plan.');
  sameTools('an article before a lowercase phrase yields nothing',
    'Built it using a small team.', []);
  sameTools('an article before a lone lowercase word yields nothing',
    'Worked with an agency.', []);

  // The determiners of #4004 still mark ordinary reference: the clause is
  // prose, or the fragment is skipped, and the name inside is left unread.
  passes('"the" before a name is still ordinary reference',
    reactOnly, '- Built the platform using the Kubernetes cluster.');
  passes('"our" before a name is still ordinary reference',
    reactOnly, '- Built the platform using our Kubernetes cluster.');
  passes('"their" before a name is still ordinary reference',
    reactOnly, '- Built the platform using their Kubernetes cluster.');
  blocksOn('a determiner later in a list taints only its own fragment',
    reactOnly, '- Built the platform using React, the Kubernetes cluster and an Elasticsearch index.', ['elasticsearch']);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
