import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, isRegularContainedFile } from "@/lib/career-ops";
import { inlineDisposition } from "@/lib/content-disposition.mjs";
import { readState, reportKey } from "@/lib/cv-studio/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One saved Studio version's PDF, looked up through the report's state file.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const report = reportKey(params.get("n") ?? "");
  const id = Number(params.get("v"));
  if (!report || !Number.isInteger(id)) return new Response("invalid request", { status: 400 });
  const root = careerOpsRoot();
  const version = readState(root, report)?.versions.find((v) => v.id === id);
  if (!version) return new Response("no such version", { status: 404 });
  const file = path.resolve(root, version.pdf);
  const studioDir = path.resolve(root, "output", "studio");
  if (!isRegularContainedFile(file, studioDir)) return new Response("no such version", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": inlineDisposition(path.basename(file)), "Cache-Control": "no-store" },
  });
}
