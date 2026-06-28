#!/usr/bin/env node
/**
 * record-fixtures — save the win-probability of available matches as replay
 * fixtures, so the demo has real recorded data to play back.
 *
 * Pulls the fixtures snapshot + per-fixture odds from the TxLINE feed, de-margins
 * the 1X2 odds into a win-probability (the same maths as lib/data/beliefEngine),
 * and writes one file per match to lib/fixtures/recorded/<id>.json — the same
 * ReplayFixture shape the app already plays (see hero-comeback.json).
 *
 * Dependency-free (Node 18+ global fetch). Auth + hosts come from the TxLINE
 * docs; see docs/ONCHAIN_SETUP.md.
 *
 *   # one-time: get an API token (subscribe SL12 on devnet → activate)
 *   TXLINE_API_TOKEN=<token> node scripts/record-fixtures.mjs
 *   # options: TXLINE_JWT=<jwt>  LIMIT=8  TXLINE_API_BASE=https://txline-dev.txodds.com/api
 *
 * NOTE: the exact fixtures/odds response field names aren't pinned in the public
 * docs. The two `pick*` mappers below try the common shapes and log the raw
 * payload on a miss — adjust them once you see a real response, then re-run.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_BASE = process.env.TXLINE_AUTH_BASE || "https://txline.txodds.com";
const API_BASE = (
  process.env.TXLINE_API_BASE || "https://txline-dev.txodds.com/api"
).replace(/\/+$/, "");
const API_TOKEN = process.env.TXLINE_API_TOKEN;
const LIMIT = Number(process.env.LIMIT || 6);

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "fixtures",
  "recorded",
);

if (!API_TOKEN) {
  console.error(
    "Set TXLINE_API_TOKEN (subscribe SL12 on devnet → activate). See docs/ONCHAIN_SETUP.md.",
  );
  process.exit(1);
}

/** De-margin 1X2 decimal odds → probabilities that sum to 1. */
function deMargin(home, draw, away) {
  const ih = 1 / home,
    id = 1 / draw,
    ia = 1 / away;
  const s = ih + id + ia || 1;
  return { pHome: ih / s, pDraw: id / s, pAway: ia / s };
}

async function getJwt() {
  if (process.env.TXLINE_JWT) return process.env.TXLINE_JWT;
  const r = await fetch(`${AUTH_BASE}/auth/guest/start`, { method: "POST" });
  if (!r.ok) throw new Error(`guest/start → ${r.status}`);
  const body = await r.json();
  return body.token || body.jwt || body;
}

const headers = (jwt) => ({
  Authorization: `Bearer ${jwt}`,
  "X-Api-Token": API_TOKEN,
  Accept: "application/json",
});

/** Pull {id, home, away, competition} out of a fixture record (best-effort). */
function pickFixture(f) {
  const id = f.fixtureId ?? f.id ?? f.fixture_id;
  const home = f.home ?? f.homeTeam ?? f.home_name ?? f.competitors?.[0]?.name;
  const away = f.away ?? f.awayTeam ?? f.away_name ?? f.competitors?.[1]?.name;
  const competition = f.competition ?? f.league ?? f.tournament ?? "TxLINE";
  return id && home && away ? { id, home, away, competition } : null;
}

/** Pull {home, draw, away} decimal odds out of an odds payload (best-effort). */
function pickOneXTwo(o) {
  const p = o?.prices ?? o?.odds ?? o?.["1x2"] ?? o;
  const home = p?.home ?? p?.["1"] ?? p?.h;
  const draw = p?.draw ?? p?.["X"] ?? p?.x ?? p?.d;
  const away = p?.away ?? p?.["2"] ?? p?.a;
  return home && draw && away
    ? { home: +home, draw: +draw, away: +away }
    : null;
}

async function main() {
  const jwt = await getJwt();
  const h = headers(jwt);
  await mkdir(OUT_DIR, { recursive: true });

  const fxRes = await fetch(`${API_BASE}/fixtures/snapshot`, { headers: h });
  if (!fxRes.ok) {
    throw new Error(
      `fixtures/snapshot → ${fxRes.status}. Confirm the path against the docs.`,
    );
  }
  const raw = await fxRes.json();
  const fixtures = (Array.isArray(raw) ? raw : raw.fixtures || raw.data || [])
    .slice(0, LIMIT);
  console.log(`Fetched ${fixtures.length} fixtures.`);

  let saved = 0;
  for (const rec of fixtures) {
    const fx = pickFixture(rec);
    if (!fx) {
      console.warn("Could not map fixture — adjust pickFixture():", rec);
      continue;
    }
    const oddsRes = await fetch(
      `${API_BASE}/odds/snapshot/${fx.id}?asOf=${Date.now()}`,
      { headers: h },
    );
    if (!oddsRes.ok) {
      console.warn(`odds/snapshot/${fx.id} → ${oddsRes.status}, skipping`);
      continue;
    }
    const oneXTwo = pickOneXTwo(await oddsRes.json());
    if (!oneXTwo) {
      console.warn(`No 1X2 for ${fx.id} — adjust pickOneXTwo()`);
      continue;
    }
    const { pHome, pDraw, pAway } = deMargin(
      oneXTwo.home,
      oneXTwo.draw,
      oneXTwo.away,
    );
    const fixture = {
      fixture: {
        fixtureId: String(fx.id),
        home: fx.home,
        away: fx.away,
        competition: fx.competition,
      },
      // Single live snapshot → seed of a replay; re-run over time (or walk asOf)
      // to capture the full curve. winProb cached alongside the source odds.
      winProb: { pHome, pDraw, pAway },
      events: [
        {
          tMs: 0,
          kind: "odds",
          messageId: `rec-${fx.id}-0`,
          home: oneXTwo.home,
          draw: oneXTwo.draw,
          away: oneXTwo.away,
          minute: 0,
        },
        { tMs: 0, kind: "score", scoreHome: 0, scoreAway: 0, minute: 0 },
      ],
      proofs: {},
    };
    await writeFile(
      join(OUT_DIR, `${fx.id}.json`),
      JSON.stringify(fixture, null, 2) + "\n",
    );
    saved += 1;
    console.log(
      `Saved ${fx.home} v ${fx.away} — win prob ${(pHome * 100).toFixed(0)}/${(
        pDraw * 100
      ).toFixed(0)}/${(pAway * 100).toFixed(0)}`,
    );
  }
  console.log(`Done. ${saved} match(es) written to lib/fixtures/recorded/.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
