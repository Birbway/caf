import { pass, fail } from './helpers.mjs';
import { factClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nA tool named after a leading "a" or "an"');

// The tool gate is fail-closed: a name the sources never mention blocks the
// render. A piece led by "a" or "an" used to be dropped by the prose-word
// check, so "using a Kubernetes cluster" was never compared with cv.md and a
// fabricated name passed.
//
// The design rule: a leading article changes nothing about WHETHER a fragment
// is a tool claim, only WHAT is checked. The article is stripped and the rest
// goes through the decision a fragment with no article gets. If that claims
// nothing, so does the article form. If it claims the whole fragment, the
// claims are the tool-shaped names in it instead, each alone, so a source that
// says "Kubernetes" backs "a Kubernetes cluster". The names are capitalised
// words, words with a digit or an inner capital, and dotted names such as
// "node.js". A fragment with none of them ("a small team", "a 2024 roadmap")
// claims nothing. The determiners of #4004 ("the", "our", "their") still mark
// ordinary reference.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-leading-article-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));

  const reactOnly = '- Built the platform using React.';

  const check = (cv, target) => {
    writeFileSync(source, `${cv}\n`);
    return verifyFacts(target, { sourcePaths: [source], configPath: config });
  };
  // Claims are compared as sets: the order they come in is not part of the contract.
  const sorted = values => [...values].sort();
  const sameSet = (found, expected) => JSON.stringify(sorted(found)) === JSON.stringify(sorted(expected));
  const tools = result => result.unsupportedFacts.filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const toolValues = text => factClaims(text).filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const blocksOn = (label, cv, target, expected) => {
    const result = check(cv, target);
    const found = tools(result);
    if (result.verdict === 'block' && sameSet(found, expected)) pass(label);
    else fail(`${label}: expected a block on exactly ${JSON.stringify(expected)}, got ${result.verdict} ${JSON.stringify(found)}`);
  };
  const passes = (label, cv, target) => {
    const result = check(cv, target);
    if (result.verdict === 'pass' && result.unsupportedFacts.length === 0) pass(label);
    else fail(`${label}: expected a clean pass, got ${result.verdict} ${JSON.stringify(result.unsupportedFacts)}`);
  };
  const claims = (label, text, expected) => {
    const found = toolValues(text);
    if (sameSet(found, expected)) pass(label);
    else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(found)}`);
  };
  // The article form must reach the verdict the same sentence reaches without
  // it, against a source that backs neither and against one that backs both.
  const sameVerdict = (label, withArticle, without, backedCv) => {
    for (const [cv, which] of [[reactOnly, 'unbacked'], [backedCv, 'backed']].filter(([cv]) => cv)) {
      const a = check(cv, withArticle);
      const b = check(cv, without);
      if (a.verdict === b.verdict) pass(`${label} (${which})`);
      else fail(`${label} (${which}): "${withArticle}" is ${a.verdict} ${JSON.stringify(tools(a))}, "${without}" is ${b.verdict} ${JSON.stringify(tools(b))}`);
    }
  };
  const sameClaims = (label, withArticle, without) => {
    const a = toolValues(withArticle);
    const b = toolValues(without);
    if (sameSet(a, b)) pass(label);
    else fail(`${label}: "${withArticle}" claims ${JSON.stringify(a)}, "${without}" claims ${JSON.stringify(b)}`);
  };

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
  blocksOn('a name after "an" in a declared list is checked',
    reactOnly, 'Technologies: React, an Elasticsearch index', ['elasticsearch']);
  blocksOn('a name after "an" behind a later "using" is checked',
    reactOnly, '- Built the platform using React, using an Elasticsearch.', ['elasticsearch']);
  blocksOn('a name after a capitalised "A" is checked',
    reactOnly, '- Built the platform using A Kubernetes cluster.', ['kubernetes']);
  blocksOn('a name after "an" behind "worked with" is checked',
    reactOnly, '- Worked with an Elasticsearch cluster.', ['elasticsearch']);

  // After the article the name is checked alone, so a source that says
  // "Kubernetes" backs "a Kubernetes cluster".
  claims('a name after "a" is read without the noun behind it',
    'Built the platform using a Kubernetes cluster.', ['kubernetes']);
  claims('a name after "an" is read without the noun behind it',
    'Built the platform using an Elasticsearch index.', ['elasticsearch']);
  claims('a dotted name after "a" is read without the noun behind it',
    'Built the platform using a Next.js app.', ['next', 'next.js']);

  // F1: a lowercase suffix joined by a hyphen describes the name, it is not
  // part of it. A name with a digit after the hyphen stays whole.
  for (const [article, name, suffix, noun] of [
    ['a', 'Kubernetes', 'based', 'stack'],
    ['an', 'AI', 'powered', 'workflow'],
    ['a', 'Salesforce', 'native', 'app'],
  ]) {
    const phrase = `${article} ${name}-${suffix} ${noun}`;
    blocksOn(`"${phrase}" is checked as ${name.toLowerCase()}`,
      reactOnly, `- Built the platform using ${phrase}.`, [name.toLowerCase()]);
    passes(`"${phrase}" passes when the source backs ${name}`,
      `- Ran workloads using ${name}.`, `- Built the platform using ${phrase}.`);
  }
  blocksOn('a name with a version after a hyphen stays whole',
    '- Drafted copy using GPT-3.', '- Drafted copy using a GPT-4 agent.', ['gpt-4']);
  passes('a backed name with a version after a hyphen passes',
    '- Drafted copy using GPT-4.', '- Drafted copy using a GPT-4 agent.');
  blocksOn('a single capital letter before a hyphen stays whole',
    reactOnly, '- Built the platform using an E-commerce site.', ['e-commerce']);

  // F2: a single quote around a name is not part of it, straight or curly.
  for (const [label, open, close] of [['straight', "'", "'"], ['curly', '‘', '’']]) {
    blocksOn(`a name in ${label} single quotes after an article is checked`,
      reactOnly, `- Built the platform using an ${open}Elasticsearch${close} index.`, ['elasticsearch']);
    passes(`a backed name in ${label} single quotes after an article passes`,
      '- Ran search on Elasticsearch.', `- Built the platform using an ${open}Elasticsearch${close} index.`);
    blocksOn(`a name in ${label} single quotes later in a list is checked`,
      reactOnly, `- Built the platform using React and an ${open}Elasticsearch${close} index.`, ['elasticsearch']);
  }

  // F3: a possessive is the name followed by "'s".
  for (const [label, mark] of [['straight', "'"], ['curly', '’']]) {
    blocksOn(`a name with a ${label} possessive after an article is checked as the name`,
      reactOnly, `- Built the platform using an Elasticsearch${mark}s index.`, ['elasticsearch']);
    passes(`a backed name with a ${label} possessive after an article passes`,
      '- Ran search on Elasticsearch.', `- Built the platform using an Elasticsearch${mark}s index.`);
  }

  // F4: the article form reaches the verdict of the same text without it,
  // because it goes through the same decision. Where the sentence without an
  // article claims nothing, the one with it claims nothing either.
  const financeBacked = '- Partnered with the CFO and Finance.';
  sameVerdict('"Worked with a Finance team" reads as "Worked with Finance team"',
    '- Worked with a Finance team.', '- Worked with Finance team.', financeBacked);
  sameVerdict('"Worked with a CFO" reads as "Worked with CFO"',
    '- Worked with a CFO.', '- Worked with CFO.', financeBacked);
  sameVerdict('"using a Building permit" reads as "using Building permit"',
    '- Built it using a Building permit.', '- Built it using Building permit.', '- Handled the Building permit process.');
  sameVerdict('"using a U.S. team" reads as "using U.S. team"',
    '- Built it using a U.S. team.', '- Built it using U.S. team.', '- Led the U.S. team.');
  sameClaims('"Worked with a Finance team" claims what "Worked with Finance team" claims',
    'Worked with a Finance team.', 'Worked with Finance team.');
  sameClaims('"Worked with a CFO" claims what "Worked with CFO" claims',
    'Worked with a CFO.', 'Worked with CFO.');
  // F5: a digit in a name keeps the name, and a number alone names nothing.
  blocksOn('a name with a digit after "an" is checked as the name',
    reactOnly, '- Stored the exports using an S3 bucket.', ['s3']);
  passes('a backed name with a digit after "an" passes',
    '- Stored exports in S3.', '- Stored the exports using an S3 bucket.');
  blocksOn('a lowercase name with a digit after "an" is checked as the name',
    reactOnly, '- Automated the intake using an n8n workflow.', ['n8n']);
  passes('a backed lowercase name with a digit after "an" passes',
    '- Automated the intake using n8n.', '- Automated the intake using an n8n workflow.');
  blocksOn('a versioned name after "a" is checked as the name',
    reactOnly, '- Ran the build using a Python 3 runtime.', ['python']);

  // F6: a single capital letter is a language when a noun follows it.
  blocksOn('"an R package" is checked as R',
    reactOnly, '- Built the model using an R package.', ['r']);
  blocksOn('"a C library" is checked as C',
    reactOnly, '- Built the service using a C library.', ['c']);
  // Without the article the whole "R package" is claimed, so a source that
  // backs R still blocks. That is the older false positive, not copied here.
  sameVerdict('"using an R package" reads as "using R package"',
    '- Built the model using an R package.', '- Built the model using R package.', null);
  passes('a backed R after "an" passes',
    '- Built models in R.', '- Built the model using an R package.');

  // Ordinary prose behind an article is not a tool: the sentence without the
  // article claims no tool-shaped name either. These also pass on unchanged
  // main, where every article fragment is dropped, so they guard the fix
  // against reading more than names.
  passes('an article before lowercase prose is not a tool',
    reactOnly, '- Built the platform using a small team.');
  passes('an article before a lowercase phrase behind "worked with" is not a tool',
    reactOnly, '- Worked with an outside agency on the launch.');
  passes('a lowercase noun phrase behind "worked with" is not a tool',
    reactOnly, '- Worked with an outside agency.');
  passes('an article before a lowercase clause in a list is not a tool',
    reactOnly, '- Built the platform using React and a custom internal workflow.');
  passes('a capitalised article before lowercase prose is not a tool',
    reactOnly, '- Built the platform using An outside agency.');
  passes('a number with a noun after an article is not a tool',
    reactOnly, '- Planned the launch using a 2024 roadmap.');
  claims('a multiplier with a noun after an article yields nothing',
    'Staffed the team using a 10x engineer.', []);
  claims('an article before a lowercase phrase yields nothing', 'Built it using a small team.', []);
  claims('an article before a lone lowercase word yields nothing', 'Worked with an agency.', []);

  // The determiners of #4004 still mark ordinary reference.
  passes('"the" before a name is still ordinary reference',
    reactOnly, '- Built the platform using the Kubernetes cluster.');
  passes('"our" before a name is still ordinary reference',
    reactOnly, '- Built the platform using our Kubernetes cluster.');
  passes('"their" before a name is still ordinary reference',
    reactOnly, '- Built the platform using their Kubernetes cluster.');
  blocksOn('a determiner later in a list taints only its own fragment',
    reactOnly, '- Built the platform using React, the Kubernetes cluster and an Elasticsearch index.', ['elasticsearch']);

  // A fragment of four or more words is read by its names, with or without the
  // article counted, as it was before. The fix must not narrow that reading.
  claims('a four-word fragment led by an article is still read by its names',
    'Built it using a mix of Python and Go.', ['python', 'go']);
  blocksOn('a four-word fragment behind "worked with" is still read by its names',
    reactOnly, '- Worked with a Board on strategy.', ['board']);

  // Regression guards. Each of these passes on unchanged main too, because it
  // never reaches the article branch or only passes there by being dropped.
  // They are kept to pin behaviour the fix must not lose, not to prove the fix.
  blocksOn('guard: a name after "an" in a bracketed list is checked',
    reactOnly, '- Built the platform using React (an Elasticsearch index).', ['elasticsearch']);
  claims('guard: every name in a long clause behind an article is read on its own',
    'Built the platform using a Kubernetes cluster on AWS across three regions.', ['kubernetes', 'aws']);
  passes('guard: a backed name after "a" passes',
    '- Ran workloads on Kubernetes.', '- Built the platform using a Kubernetes cluster.');
  passes('guard: a backed name after "an" in a later list item passes',
    '- Built it using React and ASP.NET.', '- Built the platform using React and an ASP.NET backend.');
  passes('guard: a backed dotted name after "a" passes',
    '- Shipped it using Next.js.', '- Rebuilt the storefront using a Next.js app.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
