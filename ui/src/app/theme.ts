// Hermes UI theme resolution — synced from OpenClaw with Hermes gold palette.
export type ThemeName = "hermes" | "claw" | "knot" | "dash" | "custom";
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme =
  | "dark"
  | "light"
  | "hermes"
  | "hermes-light"
  | "openknot"
  | "openknot-light"
  | "dash"
  | "dash-light"
  | "custom"
  | "custom-light";

const VALID_THEME_NAMES = new Set<ThemeName>(["hermes", "claw", "knot", "dash", "custom"]);
const VALID_THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"]);

function prefersLightScheme(): boolean {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
}

export function parseThemeSelection(
  themeRaw: unknown,
  modeRaw: unknown,
): { theme: ThemeName; mode: ThemeMode } {
  const theme = typeof themeRaw === "string" ? themeRaw : "";
  const mode = typeof modeRaw === "string" ? modeRaw : "";

  const normalizedTheme = VALID_THEME_NAMES.has(theme as ThemeName)
    ? (theme as ThemeName)
    : "hermes";
  const normalizedMode = VALID_THEME_MODES.has(mode as ThemeMode) ? (mode as ThemeMode) : "system";

  return { theme: normalizedTheme, mode: normalizedMode };
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return prefersLightScheme() ? "light" : "dark";
  }
  return mode;
}

export function resolveTheme(theme: ThemeName, mode: ThemeMode): ResolvedTheme {
  const resolvedMode = resolveMode(mode);
  if (theme === "hermes") {
    return resolvedMode === "light" ? "hermes-light" : "hermes";
  }
  if (theme === "claw") {
    return resolvedMode === "light" ? "light" : "dark";
  }
  if (theme === "knot") {
    return resolvedMode === "light" ? "openknot-light" : "openknot";
  }
  if (theme === "dash") {
    return resolvedMode === "light" ? "dash-light" : "dash";
  }
  return resolvedMode === "light" ? "custom-light" : "custom";
}

export function applyThemeToDocument(resolved: ResolvedTheme, mode: ThemeMode): void {
  const root = document.documentElement;
  const isLightFamily =
    resolved === "light" ||
    resolved === "hermes-light" ||
    resolved === "openknot-light" ||
    resolved === "dash-light" ||
    resolved === "custom-light";

  root.dataset.theme = resolved;
  root.dataset.themeMode = isLightFamily ? "light" : "dark";
  root.style.colorScheme = isLightFamily ? "light" : "dark";
}

export const THEME_OPTIONS: Array<{ id: ThemeName; label: string; description: string }> = [
  {
    id: "hermes",
    label: "Hermes",
    description: "Deep navy with warm gold accents — the default Hermes look.",
  },
  {
    id: "claw",
    label: "Claw",
    description: "Punchy red accent on layered dark surfaces.",
  },
  {
    id: "knot",
    label: "Knot",
    description: "Crimson accent on true-black canvas.",
  },
  {
    id: "dash",
    label: "Dash",
    description: "Chocolate brown accent on deep cocoa tones.",
  },
];

export const THEME_MODE_OPTIONS: Array<{ id: ThemeMode; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
