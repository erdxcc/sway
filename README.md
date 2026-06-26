# Sway — own the moment belief moved

Sway is a **mobile-first second-screen app** that turns a live football match into a
generative **field of light** driven by the market's *belief curve* — the consensus
win-probability derived in real time from TxLINE StablePrice odds. At a dramatic
moment, a fan **captures** the screen into a high-fidelity artifact whose every pixel
is a deterministic function of a single, **cryptographically verifiable** odds
datapoint — then verifies it against the on-chain Merkle root and mints it on Solana.

> It isn't a highlight reel. It's the exact moment belief flipped — rendered live from
> real market odds, verifiable on-chain, and yours to own.

The artifact is worthless if the data is fake, and **provably real because it isn't**.
That verifiability is the whole point: a fabricated moment has no valid proof and
cannot be minted.

---

## The loop

```
live odds ──▶ belief curve ──▶ field of light ──▶ capture ──▶ verify ──▶ mint
  (TxLINE)     (de-margined)      (WebGL)         (artifact)  (Merkle)   (Solana)
```

1. **Belief curve.** Decimal odds → implied probability → de-margin (remove the
   bookmaker overround) → one-euro smoothing → a `pHome / pDraw / pAway` curve plus a
   `magnitude` (drama) signal. A market **suspension → reopen** is the built-in moment
   detector — we don't invent drama, it lives in the repricing.
2. **Field of light.** A lightweight WebGL pipeline renders the curve as a glowing
   signed-distance line over a decaying temporal "wake" (where belief has *been*),
   coloured by the favoured side, with an event burst on goals.
3. **Capture.** Freezes the exact `MomentState` into a deterministic 1080×1920 card —
   same datapoint in, byte-identical artifact out.
4. **Verify + mint.** The captured odds `messageId` is checked against its Merkle proof
   and the on-chain root, then minted as a collectible on Solana (devnet).

---

## Architecture

The visual is fully decoupled from the data source by one normalised contract
([`lib/data/contract.ts`](lib/data/contract.ts)) — a `BeliefTick` stream emitted
identically by three interchangeable adapters:

| Adapter | Source | Purpose |
|---|---|---|
| `StubAdapter` | scripted | prove the visual with zero dependencies |
| `ReplayAdapter` | recorded fixture → real belief-engine | de-risk demo backbone |
| `LiveAdapter` | TxLINE SSE via our relay | the live feed |

- **Two-pipeline WebGL** ([`lib/belief/`](lib/belief/)): a cheap, mobile-budgeted live
  field (RGBA8, variable framerate, pause-when-hidden) and a deterministic, CPU-seeded
  offscreen capture renderer. Same `MomentState` → identical card.
- **Belief engine** ([`lib/data/beliefEngine.ts`](lib/data/beliefEngine.ts)): odds →
  de-margin → one-euro filter → magnitude + suspension/reopen detection.
- **SSE relay** ([`app/api/stream/route.ts`](app/api/stream/route.ts)): the browser's
  `EventSource` can't send an `Authorization` header, so a server route holds the API
  token and proxies the feed — the token never reaches the client.

```
app/{layout,page}        match/[fixtureId]/page.tsx   api/stream/route.ts
components/belief/{BeliefCanvas,CaptureModal}  hud/MatchHud.tsx
lib/belief/{BeliefField,shaders,capture,seed}.ts
lib/data/{contract,beliefEngine,stubAdapter,replayAdapter,liveAdapter}.ts
lib/txline/{config,auth}.ts   lib/fixtures/hero-comeback.json
```

---

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
OGL (WebGL2) · Geist. On-chain: Solana / Metaplex Core on devnet.

---

## Run locally

```bash
npm install
npm run dev
# open http://localhost:3000 → tap the fixture (→ /match/hero-comeback)
```

The app runs entirely on **recorded, real-shape data** out of the box — no credentials
needed. Watch the field breathe on drift, freeze + reprice on goals, then tap
**Capture this moment** to render and download the artifact card.

### Connecting the live TxLINE feed (optional)

Copy [`.env.example`](.env.example) to `.env.local` and fill in the server-side
`TXLINE_*` variables (base URL, and either a pre-issued `TXLINE_API_TOKEN` or the
subscribe-tx for the guest→activate exchange). With those set, point a fixture at the
`LiveAdapter` and the relay streams the real feed.

---

## Status

**Working now:** the generative belief-field, the full belief-engine
(de-margin → smooth → magnitude → suspension/reopen detection), the three-adapter
architecture, the deterministic capture → downloadable artifact loop, and the
env-gated server-side SSE relay + auth scaffold. `npm run build` is green.

**In progress:** wiring the live feed against confirmed TxLINE endpoint shapes;
on-chain Merkle verification + Metaplex Core mint + wallet connect (devnet), plus a
no-wallet "judge mode" for frictionless testing.

**Honesty note:** the bundled fixture is *synthetic* recorded-shape data and carries no
Merkle proofs, so its captured cards correctly read "verification pending" — we never
display a fake ✓. Real proofs come only from the live feed.

See [`SUBMISSION.md`](SUBMISSION.md) for the full writeup and the list of TxLINE
endpoints used.
