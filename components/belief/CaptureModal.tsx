"use client";

import { useEffect, useState } from "react";
import { renderMomentCard } from "@/lib/belief/capture";
import { cn } from "@/lib/cn";
import type { MomentState } from "@/lib/data/contract";

interface Props {
  /** The frozen moment to render, or null when the modal is closed. */
  moment: MomentState | null;
  onClose: () => void;
}

/**
 * Capture modal — renders the frozen moment into its collectible card and lets
 * the fan download it. Verification + mint land here next (Days 11–14); for now
 * the badge reflects the real proof state honestly (no faked "Verified").
 */
export function CaptureModal({ moment, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!moment) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setBusy(true);
    renderMomentCard(moment)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* leave url null — the modal shows the busy/failed state */
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [moment]);

  if (!moment) return null;

  const verified = Boolean(moment.merkleProof);
  const downloadName = `sway-${moment.oddsMessageId || "moment"}.png`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-bg/80 p-5 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Captured moment"
    >
      <div className="relative w-full max-w-[340px] overflow-hidden rounded-card border border-border bg-surface">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Your captured moment — the verified belief artifact"
            className="block aspect-[9/16] w-full"
          />
        ) : (
          <div className="flex aspect-[9/16] w-full items-center justify-center text-sm text-fg-muted">
            {busy ? "Rendering your moment…" : "Couldn't render this moment"}
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex items-center gap-2 rounded-pill px-4 py-1.5 text-xs font-semibold",
          verified
            ? "bg-[color-mix(in_oklab,var(--color-accent-3)_22%,transparent)] text-accent-3"
            : "bg-surface-2 text-fg-muted",
        )}
      >
        {verified
          ? "Verified ✓ real market data"
          : "Verification pending — connect the feed"}
      </div>

      <p className="max-w-[340px] text-center text-xs text-fg-faint">
        This card is the data. Its odds update is Merkle-proofed against the
        on-chain root — a fake moment can&apos;t be captured.
      </p>

      <div className="flex w-full max-w-[340px] gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-card border border-border bg-surface px-4 py-3 text-sm font-semibold text-fg transition-colors hover:bg-surface-2"
        >
          Close
        </button>
        {url ? (
          <a
            href={url}
            download={downloadName}
            className="flex-1 rounded-card bg-[image:var(--gradient-brand)] px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Download
          </a>
        ) : (
          <span className="flex-1 rounded-card bg-surface-2 px-4 py-3 text-center text-sm font-semibold text-fg-faint">
            Download
          </span>
        )}
      </div>
    </div>
  );
}
