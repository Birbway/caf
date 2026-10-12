import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { isMapping } from "@/lib/portals-config.mjs";
import { DEFAULT_PAGE_FORMAT, PAGE_FORMATS, PROFILE_PAGE_FORMAT_KEY, normalizePageFormat } from "@/lib/page-formats.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The paper size lives in config/profile.yml → page_format (a USER-LAYER file),
// the SAME key lib/page-format.mjs reads, so setting it here changes what the CLI
// renders too. Reads are live. Writes merge only this key, are atomic, and follow
// the /api/profile guards for a malformed or non-mapping profile.

export async function GET() {
  const file = path.join(careerOpsRoot(), "config", "profile.yml");
  let override: string | null = null;
  if (fs.existsSync(file)) {
    try {
      const profile = yaml.load(fs.readFileSync(file, "utf8"));
      if (isMapping(profile)) override = normalizePageFormat((profile as Record<string, unknown>)[PROFILE_PAGE_FORMAT_KEY]);
    } catch {
      /* unreadable/malformed → no override (read is best-effort) */
    }
  }
  return Response.json({
    formats: [...PAGE_FORMATS],
    default: DEFAULT_PAGE_FORMAT,
    override,
    effective: override ?? DEFAULT_PAGE_FORMAT,
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || !(PROFILE_PAGE_FORMAT_KEY in body)) {
    return Response.json({ error: `${PROFILE_PAGE_FORMAT_KEY} is required` }, { status: 400 });
  }

  // `null` removes the key, so the renderers fall back to the project default.
  const raw = body[PROFILE_PAGE_FORMAT_KEY];
  const chosen = raw === null ? null : normalizePageFormat(raw);
  if (raw !== null && !chosen) {
    return Response.json({ error: `${PROFILE_PAGE_FORMAT_KEY} must be one of: ${[...PAGE_FORMATS].join(", ")}` }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = path.join(root, "config", "profile.yml");
  let base: Record<string, unknown> = {};
  if (!fs.existsSync(file)) {
    // First create: seed from the example so we never leave a one-key profile.
    try {
      const seeded = yaml.load(fs.readFileSync(path.join(root, "config", "profile.example.yml"), "utf8"));
      base = isMapping(seeded) ? (seeded as Record<string, unknown>) : {};
    } catch {
      base = {};
    }
  } else {
    let parsed: unknown;
    try {
      parsed = yaml.load(fs.readFileSync(file, "utf8"));
    } catch {
      return Response.json({ error: "config/profile.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
    }
    if (!isMapping(parsed)) {
      return Response.json({ error: "config/profile.yml must contain named settings, not a list or single value. Refusing to overwrite it." }, { status: 409 });
    }
    base = parsed as Record<string, unknown>;
  }

  const merged: Record<string, unknown> = { ...base };
  if (chosen) merged[PROFILE_PAGE_FORMAT_KEY] = chosen;
  else delete merged[PROFILE_PAGE_FORMAT_KEY];

  try {
    atomicWriteWithBackup(file, yaml.dump(merged, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, override: chosen, effective: chosen ?? DEFAULT_PAGE_FORMAT });
}
