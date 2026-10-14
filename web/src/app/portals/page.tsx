import { Radar } from "lucide-react";
import path from "node:path";
import { PortalsView } from "@/components/portals-view";
import { careerOpsRoot } from "@/lib/career-ops";
import { loadPortalsDocument, watchedCompanies, type WatchedCompany } from "@/lib/portals-config.mjs";

export const dynamic = "force-dynamic";

function readWatched(): WatchedCompany[] {
  const root = careerOpsRoot();
  try {
    const { doc, seeded } = loadPortalsDocument(path.join(root, "portals.yml"), path.join(root, "templates", "portals.example.yml"));
    return seeded ? [] : watchedCompanies(doc);
  } catch {
    return [];
  }
}

export default function PortalsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Radar className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Portals</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        The companies career-ops watches for new roles. Run a health check to catch company boards that have quietly
        broken — a broken link means that company silently disappears from every future scan.
      </p>
      <p className="mt-1.5 text-xs text-faint">
        Backed by <code className="text-muted">portals.yml</code> — edit it directly or ask the assistant.
      </p>
      <div className="mt-6">
        <PortalsView watched={readWatched()} />
      </div>
    </div>
  );
}
