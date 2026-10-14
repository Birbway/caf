import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLiveness } from '../liveness-core.mjs';
import { shouldDedupScanHistoryRow } from '../scan.mjs';

const bodyText = 'Senior software engineer. '.repeat(20);
const reportedApplyLabels = [
  '立即申请',
  'NỘP ĐƠN ỨNG TUYỂN',
  '¡Apúntame!',
  'Solliciteren',
  '申请岗位',
];

for (const label of reportedApplyLabels) {
  test(`issue 4832: visible Apply label ${JSON.stringify(label)} keeps live posting active`, () => {
    const verdict = classifyLiveness({
      status: 200,
      requestedUrl: 'https://careers.example.com/jobs/123',
      finalUrl: 'https://careers.example.com/jobs/123',
      bodyText,
      applyControls: [label],
    });
    assert.equal(verdict.result, 'active');
    assert.equal(verdict.code, 'apply_control_visible');
  });
}

test('issue 4832: a no_apply_control history row can be reconsidered after configured recheck window', () => {
  assert.equal(
    shouldDedupScanHistoryRow(
      { firstSeen: '2025-09-01', status: 'skipped_no_apply_control' },
      { recheckAfterDays: 30, today: '2026-10-06' },
    ),
    false,
  );
});
