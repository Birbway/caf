import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { findApplication } from "@/lib/career-ops";
import { CvStudio } from "@/components/cv-studio/cv-studio";

export const dynamic = "force-dynamic";

export default async function CvStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = findApplication(id);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <Link href={`/pipeline/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand">
        <ArrowLeft className="size-4" /> Back to the report
      </Link>
      <header className="mt-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-faint">CV Studio · #{id}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-landing">
          {app ? `${app.role} at ${app.company}` : `Report #${id}`}
        </h1>
        <p className="mt-1 text-sm text-muted">Choose what goes in, put your strongest lines first, and save the version you apply with.</p>
      </header>
      <CvStudio n={id} />
    </div>
  );
}
