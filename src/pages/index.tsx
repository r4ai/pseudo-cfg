import { LazyWorkspace } from "@/features/workspace/lazy-workspace";

export default async function HomePage() {
  return (
    <div className="flex h-svh flex-col">
      <title>Pseudo CFG — pseudocode to control-flow graph</title>
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-semibold">Pseudo CFG</h1>
        <p className="truncate text-sm text-muted-foreground">
          Write pseudocode on the left, arrange the graph on the right.
        </p>
      </header>
      <main className="flex min-h-0 flex-1">
        <LazyWorkspace />
      </main>
    </div>
  );
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
