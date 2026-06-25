import { type MomentState } from "@/lib/data/contract";
import { hashSeed, makeRng } from "./seed";

/**
 * Capture renderer — freezes a {@link MomentState} into a high-fidelity 1080×1920
 * collectible card.
 *
 * Drawn on a 2D canvas so it is *deterministic by construction*: the same
 * MomentState produces a byte-identical card on any device and reload (the only
 * randomness — the frozen burst — is seeded on the CPU from `oddsMessageId`).
 * The card echoes the live field (dark ground, glowing belief curve coloured by
 * the favoured side, a frozen particle burst at the captured instant) and adds
 * the typography + verification badge that make it an artifact. No axes or grid
 * — this is a moment, not a chart.
 *
 * (A WebGL offscreen pass with full-res bloom is a documented future upgrade;
 * the 2D path is chosen for determinism and recording reliability.)
 */

export interface CaptureOptions {
  width?: number;
  height?: number;
}

const BG = "#07070b";
const FG = "#f4f4f7";
const MUTED = "#8a8a99";
const FAINT = "#5a5a68";
const HOME = "#8b5cf6";
const AWAY = "#22d3ee";
const LEVEL = "#8a8a99";
const TEAL = "#14f195";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Favoured-side colour from the home/away split, matching the live field. */
function sideColor(p: number, pAway: number): string {
  const t = clamp((p - pAway) * 2 + 0.5, 0, 1);
  return mixHex(AWAY, HOME, t);
}

/** Render the card and resolve to a PNG blob. Client-only (uses canvas). */
export async function renderMomentCard(
  moment: MomentState,
  opts: CaptureOptions = {},
): Promise<Blob> {
  const w = opts.width ?? 1080;
  const h = opts.height ?? 1920;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("capture: 2D context unavailable");

  drawCard(ctx, w, h, moment);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("capture: toBlob failed")),
      "image/png",
    );
  });
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: MomentState,
): void {
  const M = 80;
  const accent = sideColor(m.p, m.pAway);
  const favLabel =
    m.favorite === "home"
      ? m.fixtureMeta.home
      : m.favorite === "away"
        ? m.fixtureMeta.away
        : "Level";
  const favPct = Math.round(
    (m.favorite === "away"
      ? m.pAway
      : m.favorite === "home"
        ? m.p
        : 1 - m.p - m.pAway) * 100,
  );

  // --- ground: dark, faintly tinted toward the favoured side -----------------
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, BG);
  bg.addColorStop(1, mixHex(BG, accent, 0.06));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // ============================ header ======================================
  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText((m.fixtureMeta.competition || "Match").toUpperCase(), w / 2, 140);

  ctx.fillStyle = FG;
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText(`${m.fixtureMeta.home}   vs   ${m.fixtureMeta.away}`, w / 2, 210);

  ctx.fillStyle = FG;
  ctx.font = `800 190px ${FONT}`;
  ctx.fillText(`${m.scoreHome}–${m.scoreAway}`, w / 2, 420);

  ctx.fillStyle = accent;
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText(
    `${Math.floor(m.minute)}'   ·   ${favLabel.toUpperCase()} ${favPct}%`,
    w / 2,
    500,
  );

  // ============================ field / curve ===============================
  drawField(ctx, M, 600, w - M, 1360, m, accent);

  // ============================ belief bar ==================================
  drawBeliefBar(ctx, M, 1470, w - 2 * M, m);

  // ============================ verification badge ==========================
  drawBadge(ctx, w / 2, 1600, Boolean(m.merkleProof));

  // explainer (provably-real) — plan §1C
  ctx.fillStyle = FAINT;
  ctx.font = `400 26px ${FONT}`;
  ctx.textAlign = "center";
  wrapText(
    ctx,
    "This card is the data. Its odds update is Merkle-proofed against the on-chain root — a fake moment can't be captured.",
    w / 2,
    1680,
    w - 2 * M - 80,
    36,
  );

  // ============================ footer ======================================
  ctx.font = `800 52px ${FONT}`;
  ctx.textAlign = "center";
  const grad = ctx.createLinearGradient(w / 2 - 90, 0, w / 2 + 90, 0);
  grad.addColorStop(0, HOME);
  grad.addColorStop(0.5, AWAY);
  grad.addColorStop(1, TEAL);
  ctx.fillStyle = grad;
  ctx.fillText("SWAY", w / 2, 1830);

  ctx.fillStyle = MUTED;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText("own the moment belief moved", w / 2, 1872);

  ctx.fillStyle = FAINT;
  ctx.font = `400 22px ${FONT}`;
  const date = new Date(m.fixtureMeta.capturedAt).toISOString().slice(0, 10);
  ctx.fillText(`${date}   ·   ${m.oddsMessageId}`, w / 2, 1910);
}

/** The belief curve as a glowing line + soft field, with a frozen burst head. */
function drawField(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  m: MomentState,
  accent: string,
): void {
  const plotW = x1 - x0;
  const plotH = y1 - y0;
  const head = clamp(
    Math.floor((m.minute / 95) * m.curveSamples.length),
    2,
    m.curveSamples.length - 1,
  );
  const xAt = (i: number) => x0 + (i / head) * plotW;
  const yAt = (p: number) => y1 - clamp(p, 0, 1) * plotH;

  // soft glow behind the head (the "wake")
  const hx = x1;
  const hy = yAt(m.p);
  const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, 380);
  halo.addColorStop(0, mixHex(BG, accent, 0.55));
  halo.addColorStop(1, BG);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = halo;
  ctx.fillRect(x0 - 40, y0 - 40, plotW + 80, plotH + 80);
  ctx.globalCompositeOperation = "source-over";

  // filled body under the curve
  ctx.beginPath();
  ctx.moveTo(xAt(0), y1);
  for (let i = 0; i <= head; i++) ctx.lineTo(xAt(i), yAt(m.curveSamples[i]));
  ctx.lineTo(xAt(head), y1);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, y0, 0, y1);
  fill.addColorStop(0, mixHex(BG, accent, 0.35));
  fill.addColorStop(1, BG);
  ctx.fillStyle = fill;
  ctx.fill();

  // the crisp glowing line
  ctx.beginPath();
  for (let i = 0; i <= head; i++) {
    const x = xAt(i);
    const y = yAt(m.curveSamples[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 40;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // frozen burst at the head — CPU-seeded from the messageId (deterministic)
  drawBurst(ctx, hx, hy, m, accent);

  // head dot
  ctx.beginPath();
  ctx.arc(hx, hy, 12, 0, Math.PI * 2);
  ctx.fillStyle = FG;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 30;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  m: MomentState,
  accent: string,
): void {
  const rng = makeRng(hashSeed(m.oddsMessageId || "moment"));
  const count = Math.round(24 + m.magnitude * 70);
  const reach = 90 + m.magnitude * 280;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * reach;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    const size = 2 + rng() * 4;
    const a = (1 - r / reach) * (0.4 + m.magnitude * 0.5);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = mixHex(accent, FG, rng() * 0.5);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** home | draw | away split bar, always labelled + numbered (a11y). */
function drawBeliefBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  m: MomentState,
): void {
  const pDraw = clamp(1 - m.p - m.pAway, 0, 1);
  const total = m.p + pDraw + m.pAway || 1;
  const wHome = (m.p / total) * width;
  const wDraw = (pDraw / total) * width;
  const wAway = (m.pAway / total) * width;
  const barH = 18;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, barH, barH / 2);
  ctx.clip();
  ctx.fillStyle = HOME;
  ctx.fillRect(x, y, wHome, barH);
  ctx.fillStyle = mixHex(LEVEL, BG, 0.3);
  ctx.fillRect(x + wHome, y, wDraw, barH);
  ctx.fillStyle = AWAY;
  ctx.fillRect(x + wHome + wDraw, y, wAway, barH);
  ctx.restore();

  ctx.font = `500 26px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.fillText(`${Math.round(m.p * 100)}% home`, x, y + barH + 40);
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(pDraw * 100)}% draw`, x + width / 2, y + barH + 40);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(m.pAway * 100)}% away`, x + width, y + barH + 40);
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  verified: boolean,
): void {
  const label = verified
    ? "Verified ✓  real market data"
    : "Verification pending — connect the feed";
  ctx.font = `600 28px ${FONT}`;
  const tw = ctx.measureText(label).width;
  const padX = 28;
  const bw = tw + padX * 2;
  const bh = 56;
  const x = cx - bw / 2;
  const y = cy - bh / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, bh / 2);
  ctx.fillStyle = verified ? mixHex(BG, TEAL, 0.22) : "#15151f";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = verified ? TEAL : FAINT;
  ctx.stroke();
  ctx.fillStyle = verified ? TEAL : MUTED;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 2);
  ctx.textBaseline = "alphabetic";
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, cx, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, cx, yy);
}
