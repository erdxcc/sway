"use client";

import { useEffect, useRef } from "react";
import { BeliefField } from "@/lib/belief/BeliefField";
import { shouldReduceMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/cn";
import type { BeliefAdapter, BeliefTick } from "@/lib/data/contract";

interface Props {
  /** Data source — stub, replay, live or sandbox; all emit the same tick. */
  adapter: BeliefAdapter;
  /** Mirror each tick out to the parent (HUD state). */
  onTick?: (tick: BeliefTick) => void;
  /** Receives the live field so the parent can call `snapshot()` / `setTeam()`. */
  fieldRef?: React.MutableRefObject<BeliefField | null>;
  /**
   * Render the field even under reduced-motion / data-saver. The belief graph is
   * content (a data visualisation), not decorative motion, so the landing page
   * forces it on; the cheap 2D canvas is fine here.
   */
  forceMotion?: boolean;
  className?: string;
}

/**
 * React wrapper around {@link BeliefField}. Mounts the 2D field, keeps it sized +
 * paused-when-hidden, and drives the adapter's ticks into it. Falls back to a
 * static gradient under reduced-motion (unless `forceMotion`) so the screen is
 * never blank; the adapter still runs in that case, so the HUD stays live.
 */
export function BeliefCanvas({
  adapter,
  onTick,
  fieldRef,
  forceMotion,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);

  // Keep the latest onTick without resubscribing the adapter on every render.
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let field: BeliefField | null = null;
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;

    const showFallback = () => {
      if (fallbackRef.current) fallbackRef.current.style.opacity = "1";
      canvas.style.opacity = "0";
    };

    if (forceMotion || !shouldReduceMotion()) {
      field = new BeliefField();
      const ok = field.mount(canvas, { fixture: adapter.fixture, maxDpr: 2 });
      if (!ok) {
        field.destroy();
        field = null;
        showFallback();
      } else {
        if (fieldRef) fieldRef.current = field;
        canvas.style.opacity = "1";
        ro = new ResizeObserver(() => field?.resize());
        ro.observe(canvas);
        io = new IntersectionObserver(
          (entries) => field?.setInView(entries[0]?.isIntersecting ?? true),
          { threshold: 0.01 },
        );
        io.observe(canvas);
      }
    } else {
      showFallback();
    }

    const stop = adapter.start((tick) => {
      field?.pushTick(tick);
      onTickRef.current?.(tick);
    });

    return () => {
      stop();
      ro?.disconnect();
      io?.disconnect();
      if (fieldRef) fieldRef.current = null;
      field?.destroy();
    };
  }, [adapter, fieldRef, forceMotion]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <div
        ref={fallbackRef}
        className="belief-fallback absolute inset-0 transition-opacity duration-500"
        style={{ opacity: 0 }}
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full transition-opacity duration-700"
        style={{ opacity: 0, touchAction: "none" }}
        aria-hidden
      />
    </div>
  );
}
