import assert from 'node:assert/strict';
import test from 'node:test';
import rippling from '../../providers/rippling.mjs';

const entry = { name: 'Fixture', careers_url: 'https://ats.rippling.com/fixture/jobs' };

for (const [label, status, expectedAttempts] of [['404', 404, 1], ['503', 503, 3], ['network', undefined, 3]]) {
  test(`Rippling propagates the original first-page ${label} failure after retry policy`, async () => {
    const error = new Error(`fixture ${label}`);
    if (status !== undefined) error.status = status;
    let attempts = 0;
    let sleeps = 0;
    await assert.rejects(rippling.fetch(entry, {
      sleep: async () => { sleeps++; },
      fetchJson: async () => { attempts++; throw error; },
    }), (caught) => caught === error && caught.status === status);
    assert.equal(attempts, expectedAttempts);
    assert.equal(sleeps, expectedAttempts - 1);
    assert.equal(error.attempts, expectedAttempts);
  });
}

test('Rippling retries a temporary first-page failure and returns its recovered jobs', async () => {
  let attempts = 0;
  const job = { name: 'Engineer', url: 'https://ats.rippling.com/fixture/jobs/1', locations: [] };
  const jobs = await rippling.fetch(entry, {
    sleep: async () => {},
    fetchJson: async () => {
      if (++attempts === 1) throw Object.assign(new Error('fixture outage'), { status: 503 });
      return { items: [job] };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, job.url);
});

test('Rippling keeps a genuinely empty successful board empty', async () => {
  assert.deepEqual(await rippling.fetch(entry, { fetchJson: async () => ({ items: [] }) }), []);
});
