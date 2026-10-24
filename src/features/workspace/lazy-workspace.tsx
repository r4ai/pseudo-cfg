"use client";

import { lazy, Suspense } from "react";
import { ClientOnly } from "@/components/client-only";

// The editor and diagram libraries are large; load them after the page shell has painted.
const Workspace = lazy(() => import("./workspace").then((m) => ({ default: m.Workspace })));

export function LazyWorkspace() {
  const fallback = <p className="m-auto text-sm text-muted-foreground">Loading editor…</p>;
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <Workspace />
      </Suspense>
    </ClientOnly>
  );
}
