"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BeliefCanvas } from "./BeliefCanvas";
import { CaptureModal } from "./CaptureModal";
import { SheenStripes } from "./SheenStripes";
import { ReplayAdapter, type ReplayFixture } from "@/lib/data/replayAdapter";
import { ManualAdapter } from "@/lib/data/manualAdapter";
import { teamColors } from "@/lib/teams";
import { cn } from "@/lib/cn";
import type {
  BeliefAdapter,
  BeliefTick,
  MomentState,
} from "@/lib/data/contract";
import type { BeliefField } from "@/lib/belief/BeliefField";
import heroComeback from "@/lib/fixtures/hero-comeback.json";
import lateCollapse from "@/lib/fixtures/late-collapse.json";

type Team = "home" | "away";

interface MatchOption {
  id: string;
  label: string;
  kind: "sandbox" | "replay";
  fixture?: ReplayFixture;
}

/** Selectable sources: a manual sandbox + recorded past matches (history). */
const MATCHES: MatchOption[] = [
  { id: "sandbox", label: "Sandbox", kind: "sandbox" },
  {
    id: "hero-comeback",
    label: "Portugal v Argentina",
    kind: "replay",
    fixture: heroComeback as unknown as ReplayFixture,
  },
  {
    id: "late-collapse",
    label: "Brazil v Germany",
    kind: "replay",
    fixture: lateCollapse as unknown as ReplayFixture,
  },
];

const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Interactive belief graph for the landing page: a live 2D field plus controls
 * to pick a match (sandbox or a recorded past match), toggle which team's curve
 * is shown, capture the moment, and — in the sandbox — inject test goals.
 */
export function BeliefGraph() {
  const [matchId, setMatchId] = useState("sandbox");
  const [team, setTeam] = useState<Team>("home");
  const [tick, setTick] = useState<BeliefTick | null>(null);
  const [captured, setCaptured] = useState<MomentState | null>(null);
  const fieldRef = useRef<BeliefField | null>(null);

  const match = MATCHES.find((m) => m.id === matchId) ?? MATCHES[0];

  const adapter = useMemo<BeliefAdapter>(() => {
    if (match.kind === "replay" && match.fixture) {
      return new ReplayAdapter(match.fixture);
    }
    return new ManualAdapter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Re-apply the displayed team whenever it (or the mounted field) changes.
  useEffect(() => {
    fieldRef.current?.setTeam(team);
  }, [team, adapter]);

  const isSandbox = match.kind === "sandbox";
  const injectGoal = (side: Team) => {
    const a = adapter as Partial<ManualAdapter>;
    a.goal?.(side);
  };

  const capture = () => {
    const field = fieldRef.current;
    if (!field) return;
    const id = field.snapshot().oddsMessageId;
    const proof = adapter.getProof?.(id) ?? null;
    setCaptured(field.snapshot(proof));
  };

  const minute = tick ? Math.floor(tick.minute) : 0;
  const sh = tick?.scoreHome ?? 0;
  const sa = tick?.scoreAway ?? 0;
  const teamProb = team === "home" ? (tick?.pHome ?? 0.5) : (tick?.pAway ?? 0.5);
  const teamName = team === "home" ? adapter.fixture.home : adapter.fixture.away;
  const teamCol = teamColors(teamName);

  return (
    <div className="space-y-4">
      {/* The graph */}
      <div className="relative h-[48vh] min-h-[300px] w-full overflow-hidden rounded-card border border-border bg-surface">
        {/* The 2 silk sheen-stripes (Kairos), tinted by the active team flag */}
        <SheenStripes
          primary={teamCol.primary}
          secondary={teamCol.secondary}
          className="z-0"
        />
        <BeliefCanvas
          adapter={adapter}
          onTick={setTick}
          fieldRef={fieldRef}
          forceMotion
          className="absolute inset-0 z-10"
        />
        {/* HUD readouts */}
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-4">
          <div className="flex items-start justify-between">
            <span className="tnum rounded-pill bg-surface/70 px-3 py-1 text-xs font-semibold backdrop-blur-md">
              {tick?.suspended ? "SUSPENDED" : "LIVE"} · {minute}&apos;
            </span>
            <span className="tnum rounded-pill bg-surface/70 px-3 py-1 text-xs font-semibold backdrop-blur-md">
              {adapter.fixture.home} {sh}–{sa} {adapter.fixture.away}
            </span>
          </div>
          <div className="self-start rounded-card bg-surface/60 px-3 py-2 backdrop-blur-md">
            <div className="text-[10px] uppercase tracking-wider text-fg-muted">
              {teamName} win prob
            </div>
            <div
              className="tnum text-2xl font-bold"
              style={{ color: teamCol.primary }}
            >
              {pct(teamProb)}
            </div>
          </div>
        </div>
      </div>

      {/* Match selector (history of past matches + sandbox) */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
          Match
        </span>
        <div className="flex flex-wrap gap-2">
          {MATCHES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMatchId(m.id)}
              className={cn(
                "rounded-pill px-3 py-1.5 text-sm font-medium transition-colors",
                m.id === matchId
                  ? "bg-fg text-bg"
                  : "bg-surface-2 text-fg-muted hover:text-fg",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Team toggle + capture */}
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
            Team
          </span>
          <div className="flex gap-2">
            {(["home", "away"] as Team[]).map((t) => {
              const name =
                t === "home" ? adapter.fixture.home : adapter.fixture.away;
              const c = teamColors(name);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTeam(t)}
                  className={cn(
                    "rounded-pill px-4 py-1.5 text-sm font-semibold transition-colors",
                    t === team
                      ? "text-bg"
                      : "bg-surface-2 text-fg-muted hover:text-fg",
                  )}
                  style={t === team ? { backgroundColor: c.primary } : undefined}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={capture}
          className="rounded-card bg-[image:var(--gradient-brand)] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Capture
        </button>
      </div>

      {/* Test goal buttons (sandbox only) */}
      {isSandbox ? (
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
            Test
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => injectGoal("home")}
              className="rounded-pill border border-border bg-surface-2 px-4 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface"
            >
              ⚽ {adapter.fixture.home} goal
            </button>
            <button
              type="button"
              onClick={() => injectGoal("away")}
              className="rounded-pill border border-border bg-surface-2 px-4 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface"
            >
              ⚽ {adapter.fixture.away} goal
            </button>
          </div>
        </div>
      ) : null}

      <CaptureModal moment={captured} onClose={() => setCaptured(null)} />
    </div>
  );
}
