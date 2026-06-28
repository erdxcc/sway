#!/usr/bin/env node
/**
 * subscribe-activate — one-time, out-of-band: register the free World Cup
 * subscription on devnet and exchange it for a TxLINE API token.
 *
 * Flow (from the TxLINE docs): subscribe(serviceLevel, weeks) on-chain →
 * /auth/guest/start (guest JWT) → sign `${txSig}:${leagues}:${jwt}` with the
 * wallet → /api/token/activate → API token. Free tiers (SL 1 = 60s, SL 12 =
 * real-time) need no TxL payment — the tx only registers on-chain.
 *
 *   SERVICE_LEVEL_ID=12 WEEKS=4 node scripts/subscribe-activate.mjs
 *
 * Writes TXLINE_API_TOKEN / TXLINE_JWT / TXLINE_SUBSCRIBE_TXSIG to .env.local.
 * Uses the Solana CLI keypair (~/.config/solana/id.json) on devnet.
 */

import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { AnchorProvider, Program, Wallet } = anchor;

const RPC = process.env.TXLINE_RPC || "https://api.devnet.solana.com";
const AUTH_BASE = process.env.TXLINE_AUTH_BASE || "https://txline.txodds.com";
const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXL_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const SERVICE_LEVEL_ID = Number(process.env.SERVICE_LEVEL_ID || 12);
const WEEKS = Number(process.env.WEEKS || 4);
const LEAGUES = []; // empty = standard World Cup bundle

const keypairPath =
  process.env.SOLANA_KEYPAIR || join(homedir(), ".config/solana/id.json");
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))),
);

const connection = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keypair), {
  commitment: "confirmed",
});
const idl = JSON.parse(
  readFileSync(
    new URL("../lib/chain/idl/txline.devnet.json", import.meta.url),
    "utf8",
  ),
);
const program = new Program(idl, provider);

function pda(seed) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];
}

function upsertEnv(updates) {
  const file = join(process.cwd(), ".env.local");
  const lines = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean)
    : [];
  const kept = lines.filter(
    (l) => !Object.keys(updates).some((k) => l.startsWith(`${k}=`)),
  );
  for (const [k, v] of Object.entries(updates)) kept.push(`${k}=${v}`);
  writeFileSync(file, kept.join("\n") + "\n");
}

async function main() {
  console.log("Wallet:", keypair.publicKey.toBase58());
  let txSig = process.env.TXLINE_TXSIG;
  if (txSig) {
    console.log("Reusing existing subscribe tx:", txSig);
  } else {
    console.log(
      `Subscribing: SL ${SERVICE_LEVEL_ID}, ${WEEKS} week(s) (free tier)`,
    );
    const pricingMatrix = pda("pricing_matrix");
    const tokenTreasuryPda = pda("token_treasury_v2");
    const userTokenAccount = getAssociatedTokenAddressSync(
      TXL_MINT,
      keypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const tokenTreasuryVault = getAssociatedTokenAddressSync(
      TXL_MINT,
      tokenTreasuryPda,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    const preIxs = [];
    if (!(await connection.getAccountInfo(userTokenAccount))) {
      preIxs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          keypair.publicKey,
          userTokenAccount,
          keypair.publicKey,
          TXL_MINT,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
    }

    txSig = await program.methods
      .subscribe(SERVICE_LEVEL_ID, WEEKS)
      .accounts({
        user: keypair.publicKey,
        pricingMatrix,
        tokenMint: TXL_MINT,
        userTokenAccount,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .preInstructions(preIxs)
      .rpc();
    console.log("subscribe tx:", txSig);
  }

  const guest = await fetch(`${AUTH_BASE}/auth/guest/start`, {
    method: "POST",
  }).then((r) => r.json());
  const jwt = guest.token || guest.jwt || guest;

  const message = new TextEncoder().encode(
    `${txSig}:${LEAGUES.join(",")}:${jwt}`,
  );
  const walletSignature = Buffer.from(
    nacl.sign.detached(message, keypair.secretKey),
  ).toString("base64");

  let act;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const actRes = await fetch(`${AUTH_BASE}/api/token/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ txSig, walletSignature, leagues: LEAGUES }),
    });
    if (actRes.ok) {
      act = await actRes.json();
      break;
    }
    const body = await actRes.text();
    console.warn(`activate attempt ${attempt} → ${actRes.status}`);
    if (attempt === 6) {
      throw new Error(`activate failed: ${actRes.status} ${body.slice(0, 140)}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  const apiToken = act.token || act.apiToken || act;

  upsertEnv({
    TXLINE_SUBSCRIBE_TXSIG: txSig,
    TXLINE_JWT: jwt,
    TXLINE_API_TOKEN: apiToken,
  });
  console.log("API token acquired and written to .env.local ✓");
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
