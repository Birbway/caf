// Build a disposable, fictional CAREER_OPS_ROOT with one report and a tailored
// CV the pdf mode would have written. Prints the root path.
//   node tests/fixtures/cv-studio/make-root.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(here, "../../../..");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-root-")));
for (const dir of ["data", "reports", "output", "config"]) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, ".cv-studio-fixture"), "fictional-only\n");
// The dashboard loads some core modules from the data root, so link the checkout's in.
for (const name of fs.readdirSync(core)) {
  if (name.endsWith(".mjs") || ["lib", "templates", "fonts", "node_modules", "package.json"].includes(name)) fs.symlinkSync(path.join(core, name), path.join(root, name));
}
const payload = JSON.parse(fs.readFileSync(path.join(here, "payload.json"), "utf8"));
const cv = ["# Jordan Rivera", "", payload.summary, "", "## Experience"];
for (const job of payload.experience) cv.push("", `### ${job.company} - Remote`, "", `**${job.role}** (${job.dates})`, "", ...job.bullets.map((b) => `- ${b}`));
fs.writeFileSync(path.join(root, "cv.md"), cv.join("\n") + "\n");
fs.writeFileSync(path.join(root, "config/profile.yml"), "candidate:\n  full_name: Jordan Rivera\n");
fs.writeFileSync(
  path.join(root, "data/applications.md"),
  "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n| 7 | 2026-10-14 | Northwind Labs | Staff Platform Engineer | 4.4/5 | Evaluated | ✅ | [7](reports/007-northwind-labs-2026-10-14.md) | |\n",
);
fs.writeFileSync(
  path.join(root, "reports/007-northwind-labs-2026-10-14.md"),
  "# Evaluation: Northwind Labs - Staff Platform Engineer\n\n**Score:** 4.4/5\n\n## Keywords extracted\n\n- Kubernetes\n- Go\n- Terraform\n- Observability\n- Incident response\n- CI/CD\n",
);
const base = "cv-jordan-rivera-northwind-labs-2026-10-14";
fs.copyFileSync(path.join(here, "payload.json"), path.join(root, "output", `${base}.json`));
const env = { ...process.env, CAREER_OPS_ROOT: root };
execFileSync(process.execPath, [path.join(core, "build-cv-html.mjs"), path.join(root, "output", `${base}.json`), path.join(root, "output", `${base}.html`)], { cwd: root, env, stdio: "ignore" });
execFileSync(process.execPath, [path.join(core, "generate-pdf.mjs"), path.join(root, "output", `${base}.html`), path.join(root, "output", `${base}.pdf`), "--format=letter", "--report=007", "--allow-reorder"], { cwd: root, env, stdio: "ignore" });
console.log(root);
