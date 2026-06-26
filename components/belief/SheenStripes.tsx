"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

interface Props {
  /** First stripe tint — the active team's dominant flag colour. */
  primary: string;
  /** Second stripe tint — the active team's secondary flag colour. */
  secondary: string;
  className?: string;
}

/**
 * SheenStripes — the two diagonal "silk highlight" stripes from the Kairos hero
 * (`SHEEN_COUNT = 2`), re-imported as **static CSS gradients** with no fluid
 * solver. Both stripes are tinted by the active team's flag colours and drift
 * slowly behind the belief graph. Styling lives in `globals.css`
 * (`.sheen-stripes`); this only feeds the colours in as CSS custom properties.
 */
export function SheenStripes({ primary, secondary, className }: Props) {
  const style = {
    "--sheen-1": primary,
    "--sheen-2": secondary,
  } as CSSProperties;

  return (
    <div
      className={cn("sheen-stripes absolute inset-0 overflow-hidden", className)}
      style={style}
      aria-hidden
    >
      <div className="sheen sheen-1" />
      <div className="sheen sheen-2" />
    </div>
  );
}
