"use client";

/**
 * Minimal Phantom wallet access via the injected provider (`window.solana`).
 *
 * The plan deliberately avoids the full wallet-adapter UI stack — a direct
 * inject is lighter and has fewer failure points on Next 16 / React 19. Capture
 * + Merkle verify need no wallet (judge mode); only the mint flow uses this.
 * See docs/ONCHAIN_SETUP.md.
 */

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  isConnected?: boolean;
  connect(opts?: {
    onlyIfTrusted?: boolean;
  }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>;
  signTransaction(tx: unknown): Promise<unknown>;
  on(event: string, handler: (args: unknown) => void): void;
}

type WindowWithSolana = Window & {
  solana?: PhantomProvider;
  phantom?: { solana?: PhantomProvider };
};

export const PHANTOM_INSTALL_URL = "https://phantom.app/download";

/** The injected Phantom provider, or null when the extension isn't present. */
export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as WindowWithSolana;
  const provider = w.phantom?.solana ?? w.solana;
  return provider?.isPhantom ? provider : null;
}

/** Whether Phantom is installed in this browser. */
export function hasPhantom(): boolean {
  return getPhantom() !== null;
}

/** Connect (prompts the user). Resolves to the base58 public key. */
export async function connectPhantom(): Promise<string> {
  const provider = getPhantom();
  if (!provider) {
    throw new Error(`Phantom not found — install it at ${PHANTOM_INSTALL_URL}`);
  }
  const { publicKey } = await provider.connect();
  return publicKey.toString();
}

/** Silently reconnect if already trusted; resolves to the key or null. */
export async function eagerConnect(): Promise<string | null> {
  const provider = getPhantom();
  if (!provider) return null;
  try {
    const { publicKey } = await provider.connect({ onlyIfTrusted: true });
    return publicKey.toString();
  } catch {
    return null;
  }
}

export async function disconnectPhantom(): Promise<void> {
  await getPhantom()?.disconnect();
}
