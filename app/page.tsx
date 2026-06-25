import Link from "next/link";

/**
 * Landing — the entry surface. With no live feed wired yet it shows the single
 * stub hero fixture; once `LiveAdapter` lands this becomes the live fixture
 * list straight from the TxLINE feed.
 */
export default function Home() {
  return (
    <main className="container-page flex min-h-[100dvh] flex-col justify-center gap-10 py-16">
      <header className="space-y-3">
        <h1 className="text-5xl font-bold tracking-tight">
          <span className="text-gradient">Sway</span>
        </h1>
        <p className="max-w-md text-lg text-fg-muted">
          Pick a live match. Watch belief move.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
          Live now
        </h2>
        <Link
          href="/match/stub-hero"
          className="group block rounded-card border border-border bg-surface/60 p-5 transition-colors hover:border-border-strong hover:bg-surface-2/60"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
              Knockout (stub)
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent-3">
              <span className="h-2 w-2 animate-pulse rounded-pill bg-accent-3" />
              LIVE
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xl font-semibold">Home v Away</span>
            <span className="text-fg-muted transition-transform group-hover:translate-x-1">
              →
            </span>
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            A scripted hero comeback — proves the field before the feed is wired.
          </p>
        </Link>
      </section>
    </main>
  );
}
