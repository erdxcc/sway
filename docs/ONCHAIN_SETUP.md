# On-chain layer (Plan B) — setup & resources

Everything needed to turn on Sway's "provably real" layer: TxLINE auth → live
feed, Merkle verification of a captured moment, and minting it as a Solana
collectible (devnet). Capture + the belief graph already work **without** any of
this; this layer adds the verified feed and the on-chain proof/mint.

The hard blockers were external facts (program IDs, IDL, a funded keypair). The
public ones are now filled in below; only a funded devnet keypair + (optionally)
a Metaplex collection remain for you to create.

---

## 1. Where to get each technical piece (links)

### TxLINE (the data + on-chain subscription)

| Need | Link |
| --- | --- |
| Docs home / quickstart | https://txline-docs.txodds.com/documentation/quickstart |
| Full machine-readable index | https://txline-docs.txodds.com/llms.txt |
| OpenAPI spec (all endpoints) | https://txline-docs.txodds.com/api-reference/openapi.json |
| **Program addresses (devnet + mainnet)** | https://txline-docs.txodds.com/documentation/programs/addresses |
| **Devnet IDL & TypeScript types** | https://txline-docs.txodds.com/documentation/programs/devnet |
| Mainnet IDL & types | https://txline-docs.txodds.com/documentation/programs/mainnet |
| Subscription tiers / service levels | https://txline-docs.txodds.com/documentation/subscription-tiers |
| **World Cup free tier** | https://txline-docs.txodds.com/documentation/worldcup |
| On-chain validation example (Merkle) | https://txline-docs.txodds.com/documentation/examples/onchain-validation |
| Merkle proof for an odds update | https://txline-docs.txodds.com/api-reference/odds/get-a-merkle-proof-for-a-specific-odds-update |
| Real-time odds SSE stream | https://txline-docs.txodds.com/api-reference/odds/get-a-real-time-server-sent-events-stream-of-odds-updates |
| Real-time scores SSE stream | https://txline-docs.txodds.com/api-reference/scores/get-a-real-time-server-sent-events-stream-of-scores-updates |
| Guest auth endpoint | https://txline-docs.txodds.com/api-reference/authentication/start-a-new-guest-session |
| Activate → API token | https://txline-docs.txodds.com/api-reference/authentication/activate-subscription-and-retrieve-api-token |
| Partially-signed purchase quote | https://txline-docs.txodds.com/api-reference/purchase/request-a-partially-signed-purchase-quote-given-the-wallet-public-key-and-required-txline-amount-in-whole-units |
| TxODDS GitHub org | https://github.com/txodds |

### Solana / wallet / mint stack

| Need | Link |
| --- | --- |
| Solana devnet RPC | `https://api.devnet.solana.com` |
| Devnet SOL faucet | https://faucet.solana.com |
| Solana Explorer (devnet) | https://explorer.solana.com/?cluster=devnet |
| `@solana/web3.js` | https://github.com/solana-labs/solana-web3.js |
| Anchor (`@coral-xyz/anchor`) | https://www.anchor-lang.com |
| Phantom developer docs | https://docs.phantom.com/solana |
| Metaplex Core (overview) | https://developers.metaplex.com/core |
| Metaplex Core — create asset | https://developers.metaplex.com/core/create-asset |
| Umi framework | https://developers.metaplex.com/umi |
| Irys (Arweave uploader, devnet node `https://devnet.irys.xyz`) | https://docs.irys.xyz |

---

## 2. Confirmed facts (already wired into the code)

From the TxLINE docs (`programs/addresses`, `worldcup`):

**REST base:** `https://txline.txodds.com`

**Devnet program & tokens** (in [lib/chain/config.ts](../lib/chain/config.ts)):

| Role | Devnet address |
| --- | --- |
| Program ID | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL token mint | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| USDT mint (devnet) | `ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh` |

**PDA seeds** (same on both networks, derived with the network's program ID):
`token_treasury_v2`, `usdt_treasury`, `pricing_matrix`,
`daily_scores_roots` + epochDay, `daily_batch_roots` + epochDay,
`ten_daily_fixtures_roots` + aligned epochDay.

**World Cup = free.** Service levels **1** (60-second delay) and **12**
(real-time) require **no TxL payment** for World Cup / International Friendlies —
but you still send a one-time on-chain transaction that *registers* the
subscription (4-week minimum duration). So no USDT/TxL purchase is needed; you
only need a funded devnet keypair for gas.

**Auth flow:** subscribe tx (Anchor program, SL 12) → `POST /auth/guest/start`
(guest JWT) → `POST /api/token/activate` (send the tx signature + a wallet
signature) → long-lived API token → use as `Authorization: Bearer <token>`.

**Merkle verification:** proof nodes are `{ hash, isRightSibling }` (position
flags, not sorted pairs). The on-chain root lives in a PDA
`["daily_scores_roots", epochDay as u16 LE]` (scores; odds batches use
`daily_batch_roots`). Verification runs the program's `validateStat` method as a
**read-only simulation** — i.e. let the on-chain program check the proof rather
than re-implementing the hash. The exact hash function isn't in the example
page; read it off the **devnet IDL** (link above) when wiring `validateStat`.

---

## 3. What you still need to create

1. **A funded devnet keypair** (gas for the subscribe tx, and fee-payer for
   mint / judge-mode):
   ```bash
   solana-keygen new --outfile ~/.config/solana/sway-devnet.json
   solana airdrop 2 --url devnet --keypair ~/.config/solana/sway-devnet.json
   ```
   (or use the web faucet link above). Keep this **server-side only**.

2. **The devnet IDL** — download from the devnet IDL page (link above) into
   `lib/chain/idl/txline.devnet.json` for the subscribe + `validateStat` calls.

3. *(Optional, for minting)* **A Metaplex Core collection / mint authority** on
   devnet, then set `NEXT_PUBLIC_SWAY_COLLECTION`. Without it, capture + verify
   still work; only the mint button stays disabled.

---

## 4. Install the on-chain dependencies (one command, when ready)

Kept out of `package.json` until needed so the app installs lean. Run:

```bash
npm i @solana/web3.js @coral-xyz/anchor \
  @metaplex-foundation/umi @metaplex-foundation/umi-bundle-defaults \
  @metaplex-foundation/mpl-core @metaplex-foundation/umi-uploader-irys
```

`@solana/web3.js` + `@coral-xyz/anchor` → subscribe + `validateStat`.
The `@metaplex-foundation/*` set → upload the card to Arweave (Irys) and mint a
Core asset.

---

## 5. Fill the env (see [.env.example](../.env.example))

Server-side (never shipped to the browser; held by the SSE relay):
```
TXLINE_API_BASE=https://txline.txodds.com
TXLINE_SERVICE_LEVEL_ID=12
TXLINE_SUBSCRIBE_TXSIG=<signature of your devnet register tx>
# or, for local dev, a pre-issued token to skip the dance:
TXLINE_API_TOKEN=<token>
```
Browser-safe:
```
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SWAY_COLLECTION=<your Core collection address, optional>
```

---

## 6. How the prepared code fits together

| File | Status | Role |
| --- | --- | --- |
| [lib/chain/config.ts](../lib/chain/config.ts) | ready | Cluster, RPC, published TxLINE addresses, `explorerUrl()`, `isMintConfigured()` |
| [lib/chain/wallet.ts](../lib/chain/wallet.ts) | ready | Phantom via `window.solana` — connect / eager-connect / sign (no adapter stack) |
| [lib/txline/merkle.ts](../lib/txline/merkle.ts) | ready (shape) | Proof wire-types, map → `MerkleProof`, structural verify; `validateStat` sim is the marked TODO |
| [lib/chain/mint.ts](../lib/chain/mint.ts) | interface + stub | `mintMoment()` contract; throws a clear "configure" error until deps + collection exist |
| subscribe tx | doc-only | One-time, out-of-band (server/CLI) with the devnet IDL — produces `TXLINE_SUBSCRIBE_TXSIG` |

### Mint implementation template (drop into `lib/chain/mint.ts` after install)

```ts
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { create } from "@metaplex-foundation/mpl-core";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { generateSigner } from "@metaplex-foundation/umi";
import { RPC_URL, SWAY_COLLECTION, explorerUrl } from "./config";
import { getPhantom } from "./wallet";

export async function mintMoment(input: MintInput): Promise<MintResult> {
  const umi = createUmi(RPC_URL)
    .use(irysUploader({ address: "https://devnet.irys.xyz" }))
    .use(walletAdapterIdentity(getPhantom()!));

  const imageUri = await umi.uploader.upload([
    /* convert input.imageBlob to a GenericFile */
  ]);
  const metadataUri = await umi.uploader.uploadJson({
    name: input.name,
    image: imageUri,
    attributes: Object.entries(input.attributes).map(([trait_type, value]) => ({
      trait_type, value: String(value),
    })),
  });

  const asset = generateSigner(umi);
  const tx = await create(umi, {
    asset,
    name: input.name,
    uri: metadataUri,
    collection: SWAY_COLLECTION ? { publicKey: SWAY_COLLECTION } : undefined,
  }).sendAndConfirm(umi);

  const signature = /* base58 of tx.signature */ "";
  return { signature, assetId: asset.publicKey, explorerUrl: explorerUrl(signature) };
}
```
(Read the exact `uploader`/`sendAndConfirm` return shapes off the Core "create
asset" guide — they shift slightly between umi versions.)

### Verification next step

In [lib/txline/merkle.ts](../lib/txline/merkle.ts), replace the structural-only
`verifyOnChain` with an Anchor read-only simulation of `validateStat` against the
`daily_*_roots` PDA (devnet IDL). On success the capture badge can flip from
"Verification pending" to "Verified ✓ real market data" honestly.

---

## 7. Judge mode (recommended for review)

Let a judge capture + verify with **no wallet**, and mint via a server-side
fee-payer (your funded devnet keypair) so they never need SOL. Gate it behind a
`?judge=1` flag or a banner. This keeps criteria #1/#5 testable by a reviewer who
won't install Phantom.
