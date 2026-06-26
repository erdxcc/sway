"use client";

import { BeliefGraph } from "@/components/belief/BeliefGraph";

/**
 * Landing — the belief graph is the centrepiece. Pick a match (sandbox or a
 * recorded past match), switch teams, capture the moment, or test with goals.
 */
export default function Home() {
  return (
    <main className="container-page flex min-h-[100dvh] flex-col gap-6 py-10">
      <header className="space-y-1">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-gradient">Sway</span>
        </h1>
        <p className="text-fg-muted">Watch belief move. Capture the moment.</p>
      </header>

      <BeliefGraph />
    </main>
  );
}
