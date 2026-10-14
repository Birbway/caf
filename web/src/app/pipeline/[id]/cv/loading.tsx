import { Skeleton } from "@/components/ui/skeleton";

export default function CvStudioLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6" aria-label="Loading CV Studio">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-5 h-3 w-24" />
      <Skeleton className="mt-2 h-9 w-80 max-w-[80%]" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Skeleton className="h-8 w-56 rounded-full" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
        <Skeleton className="h-[70vh] w-full rounded-xl" />
      </div>
    </div>
  );
}
