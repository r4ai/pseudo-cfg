import { LazyWorkspace } from "@/features/workspace/lazy-workspace";

export default async function HomePage() {
  return (
    <div className="flex h-svh flex-col">
      <title>Pseudo CFG — pseudocode to control-flow graph</title>
      <h1 className="sr-only">Pseudo CFG</h1>
      <main className="flex min-h-0 flex-1">
        <LazyWorkspace />
      </main>
    </div>
  );
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
