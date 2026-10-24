"use client";

import { useEffect, useRef } from "react";

/** Run `fn` now and then every `ms` while the tab is visible. */
export function usePoll(fn: () => Promise<void> | void, ms: number) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") void latest.current();
    };
    run();
    const id = setInterval(run, ms);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", run);
    };
  }, [ms]);
}
