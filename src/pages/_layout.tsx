import "@/styles.css";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <meta name="description" content="Turn Python-like pseudocode into an editable control-flow graph." />
      <meta name="color-scheme" content="light dark" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <Toaster>
        <TooltipProvider>{children}</TooltipProvider>
      </Toaster>
    </>
  );
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
