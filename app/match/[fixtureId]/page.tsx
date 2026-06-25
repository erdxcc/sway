"use client";

import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { BeliefCanvas } from "@/components/belief/BeliefCanvas";
import { MatchHud } from "@/components/hud/MatchHud";
import { StubAdapter } from "@/lib/data/stubAdapter";
import type { BeliefField } from "@/lib/belief/BeliefField";
import type { BeliefTick } from "@/lib/data/contract";

/**
 * Match screen. For now every fixtureId resolves to the scripted stub so the
 * field + HUD + capture wiring can be developed and recorded without the feed.
 * The live/replay adapters drop in here later behind the same `BeliefAdapter`.
 */
export default function MatchPage() {
  const params = useParams<{ fixtureId: string }>();
  const fixtureId = params?.fixtureId ?? "stub-hero";

  // One adapter per fixture; memoised so the canvas effect doesn't resubscribe.
  const adapter = useMemo(() => new StubAdapter(), [fixtureId]);

  const [tick, setTick] = useState<BeliefTick | null>(null);
  const fieldRef = useRef<BeliefField | null>(null);

  const handleCapture = () => {
    const moment = fieldRef.current?.snapshot();
    // Capture modal lands in a later step; for now prove the snapshot is real.
    // eslint-disable-next-line no-console
    console.log("[capture]", moment);
  };

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-bg">
      <BeliefCanvas
        adapter={adapter}
        onTick={setTick}
        fieldRef={fieldRef}
        className="absolute inset-0"
      />
      <MatchHud fixture={adapter.fixture} tick={tick} onCapture={handleCapture} />
    </main>
  );
}
