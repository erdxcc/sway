import {
  type BeliefTick,
  type FixtureMeta,
  type MerkleProof,
  type MomentState,
  SAMPLE_COUNT,
} from "@/lib/data/contract";
import { teamColors } from "@/lib/teams";

/**
 * BeliefField — the live belief-graph renderer, drawn on a **2D canvas**.
 *
 * (Originally a WebGL/OGL pipeline; that failed to link reliably across GPUs, so
 * this is a robust Canvas-2D renderer instead — no shaders, works everywhere,
 * and matches the deterministic capture-card look.) It keeps a per-minute curve
 * for both teams, a fading "wake" trail on an offscreen canvas, and a glowing
 * head that pops on events. Feed it with {@link pushTick}; freeze a
 * {@link snapshot} for capture; switch the displayed team with {@link setTeam}.
 */

type Team = "home" | "away";

export interface BeliefFieldOptions {
  maxDpr?: number;
  fixture?: FixtureMeta;
  team?: Team;
}

const MATCH_MINUTES = 95;
const FG = "#f4f4f7";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export class BeliefField {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private wake: HTMLCanvasElement | null = null;
  private wctx: CanvasRenderingContext2D | null = null;

  private maxDpr = 2;
  private dpr = 1;
  private team: Team = "home";
  private fixture: FixtureMeta = {
    fixtureId: "unknown",
    home: "Home",
    away: "Away",
    competition: "",
  };

  // Per-minute curve for both teams (index = match-minute bucket).
  private curveH = new Float32Array(SAMPLE_COUNT);
  private curveA = new Float32Array(SAMPLE_COUNT);
  private lastIdx = -1;
  private last: BeliefTick | null = null;
  private burst = 0;

  private raf = 0;
  private lastFrame = 0;
  private mounted = false;
  private visible = true;
  private inView = true;

  private onVisibility = () => {
    this.visible = typeof document === "undefined" ? true : !document.hidden;
    this.updateRunState();
  };

  mount(canvas: HTMLCanvasElement, opts: BeliefFieldOptions = {}): boolean {
    this.canvas = canvas;
    this.maxDpr = opts.maxDpr ?? 2;
    if (opts.fixture) this.fixture = opts.fixture;
    if (opts.team) this.team = opts.team;

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    this.ctx = ctx;

    this.wake = document.createElement("canvas");
    this.wctx = this.wake.getContext("2d");

    this.clearCurve();
    this.resize();

    this.mounted = true;
    this.lastFrame = performance.now();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.updateRunState();
    return true;
  }

  setTeam(team: Team): void {
    this.team = team;
  }

  setInView(inView: boolean): void {
    this.inView = inView;
    this.updateRunState();
  }

  setFixture(meta: FixtureMeta): void {
    this.fixture = meta;
  }

  resize(): void {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.dpr = dpr;
    const w = Math.max(1, Math.round((this.canvas.clientWidth || 1) * dpr));
    const h = Math.max(1, Math.round((this.canvas.clientHeight || 1) * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.wake) {
      this.wake.width = w;
      this.wake.height = h;
    }
  }

  pushTick(t: BeliefTick): void {
    const idx = Math.max(
      0,
      Math.min(
        SAMPLE_COUNT - 1,
        Math.floor((t.minute / MATCH_MINUTES) * SAMPLE_COUNT),
      ),
    );
    if (idx < this.lastIdx - 2) this.clearCurve();

    const from = this.lastIdx < 0 ? idx : this.lastIdx + 1;
    for (let i = Math.min(from, idx); i <= idx; i++) {
      this.curveH[i] = clamp01(t.pHome);
      this.curveA[i] = clamp01(t.pAway);
    }
    this.lastIdx = Math.max(this.lastIdx, idx);

    if (t.event !== "drift" && t.event !== "suspend") {
      this.burst = Math.max(this.burst, t.magnitude);
    }
    this.last = t;
  }

  snapshot(merkleProof: MerkleProof | null = null): MomentState {
    const last = this.last;
    return {
      curveSamples: this.curveH.slice(0, SAMPLE_COUNT),
      p: last ? last.pHome : 0.5,
      pAway: last ? last.pAway : 0.25,
      minute: last ? last.minute : 0,
      scoreHome: last ? last.scoreHome : 0,
      scoreAway: last ? last.scoreAway : 0,
      favorite: last ? last.favorite : "level",
      event: last ? last.event : "drift",
      magnitude: last ? last.magnitude : 0,
      oddsMessageId: last ? last.oddsMessageId : "",
      merkleProof,
      fixtureMeta: {
        home: this.fixture.home,
        away: this.fixture.away,
        competition: this.fixture.competition,
        capturedAt: Date.now(),
      },
    };
  }

  destroy(): void {
    this.pause();
    this.mounted = false;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.canvas = null;
    this.ctx = null;
    this.wake = null;
    this.wctx = null;
  }

  // ----------------------------------------------------------------------- //
  // Internals
  // ----------------------------------------------------------------------- //

  private clearCurve(): void {
    this.curveH.fill(0);
    this.curveA.fill(0);
    this.lastIdx = -1;
    if (this.wctx && this.wake) {
      this.wctx.clearRect(0, 0, this.wake.width, this.wake.height);
    }
  }

  private updateRunState(): void {
    if (this.mounted && this.visible && this.inView) this.play();
    else this.pause();
  }

  private play(): void {
    if (this.raf) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;
    this.draw(dt);
    this.burst *= Math.exp(-dt / 0.5);
    if (this.burst < 0.004) this.burst = 0;
  };

  private draw(dt: number): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const wake = this.wake;
    const wctx = this.wctx;
    if (!ctx || !canvas || !wake || !wctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const dpr = this.dpr;
    const m = 16 * dpr;
    const col =
      this.team === "home"
        ? teamColors(this.fixture.home).primary
        : teamColors(this.fixture.away).primary;
    const curve = this.team === "home" ? this.curveH : this.curveA;
    const last = this.last;
    const curProb = last ? (this.team === "home" ? last.pHome : last.pAway) : 0.5;
    const head = this.lastIdx < 1 ? 0 : this.lastIdx;

    const xAt = (i: number) => m + (head > 0 ? i / head : 0) * (W - 2 * m);
    const yAt = (p: number) => H - m - clamp01(p) * (H - 2 * m);
    const hx = W - m;
    const hy = yAt(curProb);

    // --- wake trail (offscreen): faint, fast-fading glow behind the head -----
    const fade = Math.min(dt / 0.5, 0.32);
    wctx.globalCompositeOperation = "destination-out";
    wctx.fillStyle = `rgba(0,0,0,${fade})`;
    wctx.fillRect(0, 0, W, H);
    const r = (14 + this.burst * 70) * dpr + 10 * dpr;
    const g = wctx.createRadialGradient(hx, hy, 0, hx, hy, r);
    g.addColorStop(0, rgba(col, 0.2 + this.burst * 0.32));
    g.addColorStop(1, rgba(col, 0));
    wctx.globalCompositeOperation = "lighter";
    wctx.fillStyle = g;
    wctx.beginPath();
    wctx.arc(hx, hy, r, 0, Math.PI * 2);
    wctx.fill();

    // --- main canvas: clear to transparent, then a soft veil so the silk
    //     sheen-stripes mounted behind the canvas stay visible -----------------
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(7,7,11,0.62)";
    ctx.fillRect(0, 0, W, H);

    // baseline (50%)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(m, yAt(0.5));
    ctx.lineTo(W - m, yAt(0.5));
    ctx.stroke();

    // wake glow (additive)
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(wake, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // Only the selected team's curve is drawn — clicking a team in the UI
    // switches to that team's own graph (no overlaid second line).
    if (head > 0) {
      // filled body under the curve
      ctx.beginPath();
      ctx.moveTo(xAt(0), H - m);
      for (let i = 0; i <= head; i++) ctx.lineTo(xAt(i), yAt(curve[i]));
      ctx.lineTo(xAt(head), H - m);
      ctx.closePath();
      const fg = ctx.createLinearGradient(0, m, 0, H - m);
      fg.addColorStop(0, rgba(col, 0.22));
      fg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = fg;
      ctx.fill();

      // glowing line — a soft wide under-stroke + a crisp top stroke. This
      // reads as a glow WITHOUT per-frame ctx.shadowBlur, which Canvas 2D
      // rasterises over the whole ~500-point path every frame (a major stall
      // regardless of GPU power).
      ctx.beginPath();
      for (let i = 0; i <= head; i++) {
        const x = xAt(i);
        const y = yAt(curve[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = 7 * dpr;
      ctx.strokeStyle = rgba(col, 0.16);
      ctx.stroke();
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = col;
      ctx.stroke();

      // head dot — small + subdued (only swells briefly on an event burst)
      ctx.beginPath();
      ctx.arc(hx, hy, (2.4 + this.burst * 3) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = FG;
      ctx.shadowColor = col;
      ctx.shadowBlur = (5 + this.burst * 14) * dpr;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // suspended: dim the whole field (frozen)
    if (last?.suspended) {
      ctx.fillStyle = "rgba(7,7,11,0.5)";
      ctx.fillRect(0, 0, W, H);
    }
  }
}
