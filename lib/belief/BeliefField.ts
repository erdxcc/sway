import { Renderer, Program, Mesh, Triangle, RenderTarget, Texture } from "ogl";
import { VERTEX, WAKE_FRAG, DISPLAY_FRAG } from "./shaders";
import {
  type BeliefTick,
  type FixtureMeta,
  type MerkleProof,
  type MomentState,
  SAMPLE_COUNT,
} from "@/lib/data/contract";

/**
 * BeliefField — the live, mobile-budgeted belief-field renderer.
 *
 * Reuses the OGL lifecycle skeleton of the Kairos `SilkField` (graceful-fallback
 * mount, dpr cap, visibility/in-view pause, dt-clamped RAF, ping-pong FBO) but
 * replaces the Navier–Stokes fluid passes with a lightweight pipeline:
 *   - a 512×1 RGBA8 data-texture holding the belief curve over match time,
 *     updated per tick (not per frame);
 *   - a half-res RGBA8 temporal "wake" (decaying glow of where belief has been);
 *   - a single full-res SDF display pass (line glow + soft field + head + burst).
 *
 * No float render targets and no separate bloom pass, so it runs on WebGL1 and
 * WebGL2 alike. Feed it with {@link pushTick}; freeze a {@link snapshot} for
 * the capture pipeline.
 */

type GL = Renderer["gl"];

interface DoubleFBO {
  read: RenderTarget;
  write: RenderTarget;
  swap(): void;
}

export interface BeliefFieldOptions {
  /** Cap on devicePixelRatio. Default 2 (drop to 1.5 / 1 on low-end). */
  maxDpr?: number;
  /** Fixture identity (drives `snapshot().fixtureMeta`). */
  fixture?: FixtureMeta;
}

/** Match length in minutes that maps to the full curve width (incl. stoppage). */
const MATCH_MINUTES = 95;
/** Long-edge cap (device px) for the half-res wake target. */
const WAKE_MAX = 540;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Parse "#rrggbb" → normalised [r,g,b]. */
function hex3(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class BeliefField {
  private renderer: Renderer | null = null;
  private gl: GL | null = null;
  private canvas: HTMLCanvasElement | null = null;

  private maxDpr = 2;
  private fixture: FixtureMeta = {
    fixtureId: "unknown",
    home: "Home",
    away: "Away",
    competition: "",
  };

  // Belief curve store: one RGBA8 texel per sample (R=pHome,G=pAway,B=mag).
  private curveU8 = new Uint8Array(SAMPLE_COUNT * 4);
  private curveF = new Float32Array(SAMPLE_COUNT); // pHome, for the snapshot
  private lastIdx = -1;
  private tCurve!: Texture;

  private wake!: DoubleFBO;
  private wakeW = 2;
  private wakeH = 2;

  private wakeMesh!: Mesh;
  private displayMesh!: Mesh;

  // Palette (matches the CSS tokens).
  private cHome = hex3("#8b5cf6");
  private cAway = hex3("#22d3ee");
  private cLevel = hex3("#8a8a99");
  private cBg = hex3("#07070b");
  private scratchCol = new Float32Array(3);

  // Live state.
  private last: BeliefTick | null = null;
  private burst = 0;

  // Run state.
  private aspect = 1;
  private time = 0;
  private lastFrame = 0;
  private lastRender = 0;
  private raf = 0;
  private mounted = false;
  private visible = true;
  private inView = true;

  private onVisibility = () => {
    this.visible = typeof document === "undefined" ? true : !document.hidden;
    this.updateRunState();
  };

  /** Initialise GL + pipeline. Returns false if WebGL is unavailable. */
  mount(canvas: HTMLCanvasElement, opts: BeliefFieldOptions = {}): boolean {
    this.canvas = canvas;
    this.maxDpr = opts.maxDpr ?? 2;
    if (opts.fixture) this.fixture = opts.fixture;

    let renderer: Renderer;
    try {
      const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      renderer = new Renderer({
        canvas,
        width: canvas.clientWidth || 1,
        height: canvas.clientHeight || 1,
        dpr,
        alpha: false,
        antialias: false,
        depth: false,
        powerPreference: "high-performance",
      });
    } catch {
      return false; // no WebGL at all → caller shows the static fallback
    }
    if (!renderer.gl) return false;

    this.renderer = renderer;
    this.gl = renderer.gl;

    this.initCurveTexture();
    this.initPrograms();
    this.resize(); // sizes the renderer + builds the wake targets

    this.mounted = true;
    this.lastFrame = performance.now();
    this.lastRender = this.lastFrame;

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.updateRunState();
    return true;
  }

  setInView(inView: boolean): void {
    this.inView = inView;
    this.updateRunState();
  }

  setFixture(meta: FixtureMeta): void {
    this.fixture = meta;
  }

  resize(): void {
    if (!this.renderer || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.dpr = dpr;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.aspect = w / h;

    // (Re)build the half-res wake targets at the new size.
    const long = Math.max(w, h) * dpr * 0.5;
    const scale = long > WAKE_MAX ? WAKE_MAX / long : 1;
    this.wakeW = Math.max(2, Math.round(w * dpr * 0.5 * scale));
    this.wakeH = Math.max(2, Math.round(h * dpr * 0.5 * scale));
    this.wake = this.makeDoubleFBO(this.wakeW, this.wakeH);
    this.clearRT(this.wake.read);
    this.clearRT(this.wake.write);

    if (this.wakeMesh) this.wakeMesh.program.uniforms.uAspect.value = this.aspect;
    if (this.displayMesh)
      this.displayMesh.program.uniforms.uAspect.value = this.aspect;
  }

  /**
   * Feed one normalised tick: write it into the curve texture, advance the head,
   * and arm an event burst. Cheap — touches the GPU only via a small texSubImage.
   */
  pushTick(t: BeliefTick): void {
    const idx = Math.max(
      0,
      Math.min(
        SAMPLE_COUNT - 1,
        Math.floor((t.minute / MATCH_MINUTES) * SAMPLE_COUNT),
      ),
    );

    // A jump backwards means the source looped/restarted — clear and rewind.
    if (idx < this.lastIdx - 2) this.clearCurve();

    const from = this.lastIdx < 0 ? idx : this.lastIdx + 1;
    const r = Math.round(clamp01(t.pHome) * 255);
    const g = Math.round(clamp01(t.pAway) * 255);
    const b = Math.round(clamp01(t.magnitude) * 255);
    for (let i = Math.min(from, idx); i <= idx; i++) {
      const o = i * 4;
      this.curveU8[o] = r;
      this.curveU8[o + 1] = g;
      this.curveU8[o + 2] = b;
      this.curveU8[o + 3] = 255;
      this.curveF[i] = t.pHome;
    }
    this.lastIdx = Math.max(this.lastIdx, idx);

    if (this.tCurve) {
      this.tCurve.image = this.curveU8;
      this.tCurve.needsUpdate = true;
    }

    if (t.event !== "drift" && t.event !== "suspend") {
      this.burst = Math.max(this.burst, t.magnitude);
    }
    this.last = t;
  }

  /** Freeze the current state into a capture-ready, self-contained snapshot. */
  snapshot(merkleProof: MerkleProof | null = null): MomentState {
    const last = this.last;
    return {
      curveSamples: this.curveF.slice(0, SAMPLE_COUNT),
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
    const gl = this.gl;
    if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.renderer = null;
    this.gl = null;
    this.canvas = null;
  }

  // ----------------------------------------------------------------------- //
  // Internals
  // ----------------------------------------------------------------------- //

  private initCurveTexture(): void {
    const gl = this.gl!;
    this.clearCurve();
    this.tCurve = new Texture(gl, {
      image: this.curveU8,
      width: SAMPLE_COUNT,
      height: 1,
      generateMipmaps: false,
      flipY: false,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    });
  }

  private clearCurve(): void {
    this.curveU8.fill(0);
    for (let i = 0; i < SAMPLE_COUNT; i++) this.curveU8[i * 4 + 3] = 255;
    this.curveF.fill(0);
    this.lastIdx = -1;
    if (this.gl && this.wake) {
      this.clearRT(this.wake.read);
      this.clearRT(this.wake.write);
    }
  }

  private makeFBO(w: number, h: number): RenderTarget {
    const gl = this.gl!;
    return new RenderTarget(gl, {
      width: w,
      height: h,
      depth: false,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    });
  }

  private makeDoubleFBO(w: number, h: number): DoubleFBO {
    const fbo: DoubleFBO = {
      read: this.makeFBO(w, h),
      write: this.makeFBO(w, h),
      swap() {
        const t = this.read;
        this.read = this.write;
        this.write = t;
      },
    };
    return fbo;
  }

  private clearRT(rt: RenderTarget): void {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.buffer);
    gl.viewport(0, 0, rt.width, rt.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private makeMesh(
    fragment: string,
    uniforms: Record<string, { value: unknown }>,
  ): Mesh {
    const gl = this.gl!;
    const program = new Program(gl, {
      vertex: VERTEX,
      fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    return new Mesh(gl, { geometry: new Triangle(gl), program });
  }

  private initPrograms(): void {
    this.wakeMesh = this.makeMesh(WAKE_FRAG, {
      tPrev: { value: null },
      uAspect: { value: this.aspect },
      uDecay: { value: 0.96 },
      uDrift: { value: 0.0016 },
      uHead: { value: new Float32Array([0, 0.5]) },
      uHeadColor: { value: new Float32Array(this.cLevel) },
      uHeadIntensity: { value: 0.12 },
      uSigma: { value: 0.05 },
    });

    this.displayMesh = this.makeMesh(DISPLAY_FRAG, {
      tCurve: { value: this.tCurve },
      tWake: { value: null },
      uAspect: { value: this.aspect },
      uTime: { value: 0 },
      uHead: { value: 0 },
      uP: { value: 0.5 },
      uPAway: { value: 0.25 },
      uBurst: { value: 0 },
      uSuspended: { value: 0 },
      uColorHome: { value: new Float32Array(this.cHome) },
      uColorAway: { value: new Float32Array(this.cAway) },
      uColorLevel: { value: new Float32Array(this.cLevel) },
      uColorBg: { value: new Float32Array(this.cBg) },
    });
  }

  /** Lerp the favoured-side colour into the reused scratch array. */
  private sideColor(p: number, pAway: number, dim: number): Float32Array {
    const t = clamp01((p - pAway) * 2.0 + 0.5);
    for (let i = 0; i < 3; i++) {
      this.scratchCol[i] =
        (this.cAway[i] + (this.cHome[i] - this.cAway[i]) * t) * dim;
    }
    return this.scratchCol;
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

    // Variable framerate: ~34fps while drifting, ramp to ~60 on/after an event,
    // so the field is calm and battery-cheap until drama, then fluid.
    const active = this.burst > 0.04;
    const minInterval = 1000 / (active ? 60 : 34);
    if (now - this.lastRender < minInterval) return;

    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;
    this.lastRender = now;
    this.time += dt;
    this.step(dt);
  };

  private blit(mesh: Mesh, target: RenderTarget | null): void {
    this.renderer!.render({ scene: mesh, target: target ?? undefined });
  }

  private step(dt: number): void {
    if (!this.renderer) return;
    const last = this.last;
    const head = last ? clamp01(last.minute / MATCH_MINUTES) : 0;
    const p = last ? last.pHome : 0.5;
    const pAway = last ? last.pAway : 0.25;
    const suspended = last ? last.suspended : false;

    // 1. Wake feedback (half-res): decay the trail, deposit a splat at the head.
    const decay = Math.exp(-dt / 0.85); // time-consistent regardless of fps
    const wu = this.wakeMesh.program.uniforms;
    wu.tPrev.value = this.wake.read.texture;
    wu.uAspect.value = this.aspect;
    wu.uDecay.value = decay;
    (wu.uHead.value as Float32Array).set([head, p]);
    (wu.uHeadColor.value as Float32Array).set(
      this.sideColor(p, pAway, suspended ? 0.35 : 1),
    );
    wu.uHeadIntensity.value = (0.1 + this.burst * 0.7) * (suspended ? 0.3 : 1);
    this.blit(this.wakeMesh, this.wake.write);
    this.wake.swap();

    // 2. Display pass (full-res to screen).
    const du = this.displayMesh.program.uniforms;
    du.tCurve.value = this.tCurve;
    du.tWake.value = this.wake.read.texture;
    du.uAspect.value = this.aspect;
    du.uTime.value = this.time;
    du.uHead.value = head;
    du.uP.value = p;
    du.uPAway.value = pAway;
    du.uBurst.value = this.burst;
    du.uSuspended.value = suspended ? 1 : 0;
    this.blit(this.displayMesh, null);

    // 3. Decay the event burst (time-consistent).
    this.burst *= Math.exp(-dt / 0.45);
    if (this.burst < 0.004) this.burst = 0;
  }
}
