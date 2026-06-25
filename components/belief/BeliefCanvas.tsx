"use client";

import { useEffect, useRef } from "react";
import { BeliefField } from "@/lib/belief/BeliefField";
import { shouldReduceMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/cn";
import type { BeliefAdapter, BeliefTick } from "@/lib/data/contract";

interface Props {
  /** Data source — stub, live or replay; all emit the same tick. */
  adapter: BeliefAdapter;
  /** Mirror each tick out to the parent (HUD state). */
  onTick?: (tick: BeliefTick) => void;
  /** Receives the live field so the parent can call `snapshot()` at capture. */
  fieldRef?: React.MutableRefObject<BeliefField | null>;
  className?: string;
}

/**
 * React wrapper around {@link BeliefField}. Mounts the WebGL field, keeps it
 * sized + paused-when-hidden, and drives the adapter's ticks into it. Falls back
 * to a static gradient under reduced-motion / data-saver / no-WebGL so the
 * screen is never blank. The adapter still runs in the fallback case, so the HUD
 * stays live even without the field.
 */
export function BeliefCanvas({ adapter, onTick, fieldRef, className }: Props) {
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

    if (!shouldReduceMotion()) {
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
  }, [adapter, fieldRef]);

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
