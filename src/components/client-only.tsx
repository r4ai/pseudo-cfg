"use client";

import { type ReactNode, useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Renders `children` only in the browser; the static HTML gets `fallback`. */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return isClient ? children : fallback;
}
