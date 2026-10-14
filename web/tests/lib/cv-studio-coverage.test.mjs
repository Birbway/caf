import test from "node:test";
import assert from "node:assert/strict";
import * as km from "../../../keyword-match.mjs";
import { studioCoverage } from "../../src/lib/cv-studio/coverage.mjs";

const report = "# Northwind Labs\n\n## Keywords extracted\n\n- Kubernetes\n- Go\n- Terraform\n";
const generated = "<ul><li>Cut deploy time 40% by moving CI to Kubernetes</li><li>Built the metrics pipeline in Go</li></ul>";
const edited = "<ul><li>Built the metrics pipeline in Go</li></ul>";

test("coverage reflects the edited CV and names the keyword an edit removed", () => {
  const c = studioCoverage(km, report, edited, generated);
  assert.equal(c.available, true);
  assert.deepEqual(c.result.present, ["Go"]);
  assert.deepEqual(c.result.missing, ["Kubernetes", "Terraform"]);
  assert.deepEqual(c.dropped, ["Kubernetes"]);
});

test("a keyword the generated CV never had is missing but not dropped", () => {
  assert.deepEqual(studioCoverage(km, report, generated, generated).dropped, []);
});

test("a report without a keywords block or no report at all says why", () => {
  assert.deepEqual(studioCoverage(km, "# No keywords here\n", edited, generated), { available: false, reason: "no-keywords", result: null, dropped: [] });
  assert.equal(studioCoverage(km, null, edited, generated).reason, "no-report");
});
