"use client";

import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { BeliefCanvas } from "@/components/belief/BeliefCanvas";
import { CaptureModal } from "@/components/belief/CaptureModal";
import { MatchHud } from "@/components/hud/MatchHud";
import { StubAdapter } from "@/lib/data/stubAdapter";
import { ReplayAdapter, type ReplayFixture } from "@/lib/data/replayAdapter";
import heroComeback from "@/lib/fixtures/hero-comeback.json";
import type { BeliefField } from "@/lib/belief/BeliefField";
import type { BeliefAdapter, BeliefTick, MomentState } from "@/lib/data/contract";

/**
 * Match screen. For now every fixtureId resolves to the scripted stub so the
 * field + HUD + capture wiring can be developed and recorded without the feed.
 * The live/replay adapters drop in here later behind the same `BeliefAdapter`.
 */
export default function MatchPage() {
  const params = useParams<{ fixtureId: string }>();
  const fixtureId = params?.fixtureId ?? "stub-hero";

  // One adapter per fixture; memoised so the canvas effect doesn't resubscribe.
  // A recorded fixture plays through the real belief-engine; anything else falls
  // back to the scripted stub.
  const adapter = useMemo<BeliefAdapter>(() => {
    if (fixtureId === "hero-comeback") {
      return new ReplayAdapter(heroComeback as unknown as ReplayFixture);
    }
    return new StubAdapter();
  }, [fixtureId]);

  const [tick, setTick] = useState<BeliefTick | null>(null);
  const [captured, setCaptured] = useState<MomentState | null>(null);
  const fieldRef = useRef<BeliefField | null>(null);

  const handleCapture = () => {
    const field = fieldRef.current;
    if (!field) return;
    // Attach the pinned proof for this odds update (if the source has one) so
    // the captured card reflects its true verification state.
    const messageId = field.snapshot().oddsMessageId;
    const proof = adapter.getProof?.(messageId) ?? null;
    setCaptured(field.snapshot(proof));
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
      <CaptureModal moment={captured} onClose={() => setCaptured(null)} />
    </main>
  );
}
