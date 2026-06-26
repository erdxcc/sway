/**
 * Team flag-colour registry.
 *
 * Each team's belief curve and its silk "sheen stripes" are tinted by the
 * team's flag — Portugal red, Argentina sky-blue, Brazil yellow, and so on.
 * `primary` is the dominant flag colour (chosen to read on the near-black
 * surface), `secondary` is the accent used for the second sheen stripe.
 *
 * Colours are keyed by display name so fixtures only carry plain team names;
 * unknown teams fall back to the house violet/cyan accents.
 */

export interface TeamColors {
  /** Dominant flag colour — the curve, head and first sheen stripe. */
  primary: string;
  /** Secondary flag colour — the second sheen stripe. */
  secondary: string;
}

const TEAMS: Record<string, TeamColors> = {
  Portugal: { primary: "#e4322b", secondary: "#1f9d55" },
  Argentina: { primary: "#75aadb", secondary: "#f4f4f7" },
  Brazil: { primary: "#ffdf3a", secondary: "#1faf55" },
  Germany: { primary: "#e1000f", secondary: "#ffce00" },
  Spain: { primary: "#d31027", secondary: "#ffc400" },
  Netherlands: { primary: "#f57920", secondary: "#3a6ddb" },
  France: { primary: "#3d7be8", secondary: "#ef4135" },
  England: { primary: "#e23147", secondary: "#f4f4f7" },
  Italy: { primary: "#2e9e6b", secondary: "#e23147" },
  Croatia: { primary: "#e23147", secondary: "#3d7be8" },
};

/** House accents for any team not in the registry. */
export const FALLBACK_COLORS: TeamColors = {
  primary: "#8b5cf6",
  secondary: "#22d3ee",
};

/** Flag colours for a team by display name (case-insensitive). */
export function teamColors(name: string | undefined): TeamColors {
  if (!name) return FALLBACK_COLORS;
  const key = name.trim();
  return (
    TEAMS[key] ??
    Object.entries(TEAMS).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    )?.[1] ??
    FALLBACK_COLORS
  );
}
