import test from "node:test";
import assert from "node:assert/strict";
import { readMachineSummary, scoreLevers } from "../../src/lib/machine-summary.mjs";

const report = (yaml) => `# Evaluation: Northwind Labs -- Platform Engineer

**Score:** 3.4/5

## Machine Summary

\`\`\`yaml
${yaml}
\`\`\`

## A) Role Summary
`;

const full = report(`company: "Northwind Labs"
final_decision: "Consider"
hard_stops:
  - "Requires on-site in a city outside the profile"
soft_gaps: []
top_strengths:
  - "Five years of Python services"
score_evidence:
  cv_match: "supported"
  north_star: "partial"
  compensation: "unknown"
  culture: "supported"
  red_flags: "supported"
confidence_gaps:
  - "Confirm the salary band"
requirement_importance:
  - requirement: "Terraform"
    jd_signal: "Terraform at scale"
    evidence: "stated"
    importance: "meaningful"
    match: "missing"
  - requirement: "Kubernetes in production"
    jd_signal: "run Kubernetes"
    evidence: "stated"
    importance: "critical"
    match: "missing"
  - requirement: "Go"
    jd_signal: "Go preferred"
    evidence: "stated"
    importance: "preferred"
    match: "missing"
  - requirement: "On-call leadership"
    jd_signal: null
    evidence: "structural"
    importance: "high"
    match: "partial"
  - requirement: "Python"
    jd_signal: "Python"
    evidence: "stated"
    importance: "critical"
    match: "strong"`);

test("levers list hard stops first, then missing requirements by importance", () => {
  const levers = scoreLevers(readMachineSummary(full));
  assert.deepEqual(levers, {
    holding: [
      { text: "Requires on-site in a city outside the profile", importance: null },
      { text: "Kubernetes in production", importance: "critical" },
      { text: "Terraform", importance: "meaningful" },
    ],
    close: [{ text: "On-call leadership", importance: "high" }],
    verify: ["Confirm the salary band", "Compensation evidence is unknown"],
    strengths: ["Five years of Python services"],
  });
});

test("the decision comes from final_decision", () => {
  assert.equal(readMachineSummary(full).decision, "Consider");
});

test("a report without a Machine Summary has no levers to show", () => {
  assert.equal(readMachineSummary("# Evaluation: Old -- Role\n\n## A) Role Summary\n"), null);
});

test("broken YAML reads as no summary rather than throwing", () => {
  assert.equal(readMachineSummary(report("final_decision: [unclosed")), null);
});

test("requirements with an unknown importance band are dropped", () => {
  const s = readMachineSummary(report(`requirement_importance:
  - requirement: "Rust"
    importance: "essential"
    match: "missing"
  - requirement: "SQL"
    importance: "high"
    match: "missing"`));
  assert.deepEqual(s.requirements, [{ requirement: "SQL", importance: "high", match: "missing" }]);
});
