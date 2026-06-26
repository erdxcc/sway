# Sway — submission writeup

**Sway — own the moment belief moved.**

## Overview

Sway is a mobile-first second-screen app that visualizes a football match as a living
field of light driven by the market's *belief curve* — the consensus win-probability
derived in real time from TxLINE StablePrice odds. At any dramatic moment, a fan
captures the screen into a high-fidelity artifact whose every pixel is a deterministic
function of a single, cryptographically verifiable odds datapoint. The artifact is
verified against the on-chain Merkle root and minted on Solana — a collectible that is
worthless if the data is fake and provably real because it isn't.

## Core idea

Odds already encode the entire emotional arc of a match, but as cold numbers behind a
paywall. Sway de-margins them into a win-probability curve and renders it as a
generative, reactive visual — then lets fans *own* the exact swings that mattered, with
on-chain proof that the moment is genuine. The originality is the loop
**capture → verify → mint**; the visual is the medium, not the gimmick.

## Key technical points

1. **Belief engine.** Decimal odds → implied probability → overround removal
   (de-margin) → one-euro smoothing (cuts jitter, preserves sharp jumps) →
   magnitude/jump detection, with **suspension → reopen** as a built-in moment
   detector.
2. **Two-pipeline WebGL.** A cheap, mobile-budgeted live SDF field (RGBA8, variable
   framerate, a half-res temporal "wake" instead of a separate bloom pass, pause-when-
   hidden, degradation ladder) and a deterministic high-fidelity offscreen capture
   renderer. Identical `MomentState` in → identical card out, because the only
   randomness (the frozen burst) is seeded on the CPU from the odds `messageId`.
3. **Decoupled data contract.** One normalised `BeliefTick` stream is emitted
   identically by three adapters (stub / replay / live), so the visual and capture
   pipelines never know about an API.
4. **Verification.** The captured odds `messageId` is checked against its Merkle proof
   and the on-chain root. A fake datapoint has no valid proof and cannot be captured or
   minted.
5. **On-chain.** TxLINE guest-auth + Service Level 12 subscription; the artifact is
   minted as a Metaplex Core asset on devnet with metadata referencing the verified
   datapoint. A server-side relay holds the API token so it never reaches the browser.

## Key business points

A new consumer collectible category tied to live sport: primary-market drops for
leagues, books and sponsors; premium "verified moment" mints; a fan-engagement surface
that runs the whole 90 minutes. The verifiability is the moat — only real,
market-confirmed moments can be minted.

## TxLINE endpoints used

- `POST /auth/guest/start` — guest JWT
- on-chain subscribe (Anchor program, Token-2022 PDAs, `SERVICE_LEVEL_ID=12`)
- `POST /api/token/activate` — exchange the signed `txSig:leagues:jwt` for the API token
- `fixtures: latest snapshot` — match list
- `odds: snapshots of latest odds for a fixture` (`asOf`) — current + history (replay record)
- `odds: real-time SSE stream` — live belief
- `scores: real-time SSE stream` — live score / events
- `scores: full sequence of score updates for a fixture` — replay record / resolution
- `odds: Merkle proof for a specific odds update` (by `messageId`) — artifact verification
- On-Chain Validation reference — verify the proof against the on-chain root

## API feedback

The SL12 SSE feed is genuinely sub-second and was the highlight to build on. Three
things cost us time and would help other builders:

1. **Reconnect has no documented gapless cursor**, so clients must re-snapshot after
   every drop — a "since `messageId`" resume token would help.
2. **Aligning an odds `messageId` to a specific score event is non-trivial** because
   live odds come from a 5-minute in-memory queue and history is bucketed to 5-minute
   intervals — a "latest odds `messageId` at score-event time" helper would make
   verifiable moment-capture much easier.
3. **The docs' on-chain examples are mainnet-beta** while the track allows devnet, which
   created day-one ambiguity about where the subscription program is deployed — an
   explicit devnet address block would remove it.
