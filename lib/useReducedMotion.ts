"use client";

import { useEffect, useState } from "react";

/** True when the visitor signalled Save-Data on their connection. */
function hasSaveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return Boolean(connection?.saveData);
}

/**
 * Pure check (safe to call inside effects / non-React code paths) for whether
 * we should avoid heavy motion: honours prefers-reduced-motion, the
 * prefers-reduced-data media query, and the Save-Data client hint.
 */
export function shouldReduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    window.matchMedia("(prefers-reduced-data: reduce)").matches ||
    hasSaveData()
  );
}

/**
 * React hook mirror of {@link shouldReduceMotion}. Starts `false` so SSR markup
 * is stable, then resolves on mount and stays in sync with media changes.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const data = window.matchMedia("(prefers-reduced-data: reduce)");
    const update = () => setReduced(shouldReduceMotion());

    update();
    motion.addEventListener("change", update);
    data.addEventListener("change", update);
    return () => {
      motion.removeEventListener("change", update);
      data.removeEventListener("change", update);
    };
  }, []);

  return reduced;
}
