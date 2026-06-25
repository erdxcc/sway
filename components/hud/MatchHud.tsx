"use client";

import { cn } from "@/lib/cn";
import type { BeliefEvent, BeliefTick, FixtureMeta } from "@/lib/data/contract";

interface Props {
  fixture: FixtureMeta;
  tick: BeliefTick | null;
  onCapture?: () => void;
}

/** Toast copy per discrete event (English UI strings — plan §1C). */
const EVENT_COPY: Partial<Record<BeliefEvent, string>> = {
  goal: "Goal — market repricing…",
  red: "Red card",
  pen: "Penalty",
  var: "VAR check",
  suspend: "Market suspended…",
  reopen: "Market reopened",
  whistle: "Full time",
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Second-screen HUD overlaid on the belief field. Presentational only: it reads
 * the latest tick and shows minute / scoreline / win-probability, a
 * home–draw–away belief bar (always labelled + numbered, never colour-only), an
 * event toast, and the capture CTA. Pointer events pass through except on the
 * button, so the field stays interactive underneath.
 */
export function MatchHud({ fixture, tick, onCapture }: Props) {
  const minute = tick ? Math.floor(tick.minute) : 0;
  const sh = tick?.scoreHome ?? 0;
  const sa = tick?.scoreAway ?? 0;
  const pHome = tick?.pHome ?? 0.5;
  const pDraw = tick?.pDraw ?? 0;
  const pAway = tick?.pAway ?? 0.5;
  const favorite = tick?.favorite ?? "level";

  const favTeam =
    favorite === "home"
      ? fixture.home
      : favorite === "away"
        ? fixture.away
        : "Level";
  const favPct = favorite === "away" ? pAway : favorite === "home" ? pHome : pDraw;

  const event = tick?.event ?? "drift";
  const toast = EVENT_COPY[event];
  const isGoal = event === "goal";
  const suspended = tick?.suspended ?? false;

  // Belief bar segment widths (normalised so they always fill the track).
  const total = pHome + pDraw + pAway || 1;
  const wHome = (pHome / total) * 100;
  const wDraw = (pDraw / total) * 100;
  const wAway = (pAway / total) * 100;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 text-fg">
      {/* Top row: competition + live clock */}
      <header className="flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          {fixture.competition || "Match"}
        </div>
        <div className="flex items-center gap-2 rounded-pill bg-surface/70 px-3 py-1 backdrop-blur-md">
          <span
            className={cn(
              "h-2 w-2 rounded-pill",
              suspended ? "bg-fg-muted" : "animate-pulse bg-accent-3",
            )}
          />
          <span className="tnum text-xs font-semibold">
            {suspended ? "SUSPENDED" : "LIVE"} · {minute}&apos;
          </span>
        </div>
      </header>

      {/* Event toast */}
      <div className="flex justify-center">
        {toast && event !== "drift" ? (
          <div
            className={cn(
              "rounded-pill px-4 py-1.5 text-sm font-semibold backdrop-blur-md",
              isGoal ? "bg-accent/80 text-white" : "bg-surface/80 text-fg",
            )}
          >
            {toast}
          </div>
        ) : null}
      </div>

      {/* Bottom panel: scoreline, belief readout, capture CTA */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold">{fixture.home}</span>
            <span className="tnum text-3xl font-bold">
              {sh}–{sa}
            </span>
            <span className="text-lg font-semibold">{fixture.away}</span>
          </div>
        </div>

        <div className="rounded-card bg-surface/60 p-4 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Market belief
            </span>
            <span className="tnum text-sm font-semibold">
              {pct(favPct)} {favTeam}
            </span>
          </div>

          {/* home | draw | away belief bar */}
          <div className="flex h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full bg-[var(--color-home)] transition-[width] duration-300"
              style={{ width: `${wHome}%` }}
            />
            <div
              className="h-full bg-[var(--color-level)]/50 transition-[width] duration-300"
              style={{ width: `${wDraw}%` }}
            />
            <div
              className="h-full bg-[var(--color-away)] transition-[width] duration-300"
              style={{ width: `${wAway}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-fg-faint">
            <span className="tnum">{pct(pHome)} home</span>
            <span className="tnum">{pct(pDraw)} draw</span>
            <span className="tnum">{pct(pAway)} away</span>
          </div>
          <p className="mt-2 text-[10px] text-fg-faint">
            de-margined from live odds
          </p>
        </div>

        <button
          type="button"
          onClick={onCapture}
          className={cn(
            "pointer-events-auto w-full rounded-card px-5 py-3.5 text-center font-semibold text-white transition-transform active:scale-[0.98]",
            "bg-[image:var(--gradient-brand)]",
            isGoal && "animate-pulse",
          )}
        >
          Capture this moment
          <span className="mt-0.5 block text-xs font-normal text-white/80">
            freeze the verified datapoint
          </span>
        </button>
      </section>
    </div>
  );
}
