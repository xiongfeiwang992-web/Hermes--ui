// Hermes UI — /theme slash command parser.
import type { ThemeMode, ThemeName } from "./theme.ts";

export type ThemeCommandPatch =
  | { kind: "theme"; theme: ThemeName }
  | { kind: "mode"; mode: ThemeMode };

export type ThemeCommandResult =
  | { ok: true; patch: ThemeCommandPatch; message: string }
  | { ok: false; message: string };

const THEME_ALIASES: Record<string, ThemeName> = {
  hermes: "hermes",
  claw: "claw",
  knot: "knot",
  dash: "dash",
  custom: "custom",
  default: "hermes",
};

const MODE_ALIASES: Record<string, ThemeMode> = {
  system: "system",
  light: "light",
  dark: "dark",
};

export function parseThemeCommand(input: string): ThemeCommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/theme")) {
    return null;
  }

  const arg = trimmed.slice("/theme".length).trim().toLowerCase();
  if (!arg) {
    return {
      ok: false,
      message: "Usage: /theme <hermes|claw|knot|dash|system|light|dark>",
    };
  }

  const theme = THEME_ALIASES[arg];
  if (theme) {
    return {
      ok: true,
      patch: { kind: "theme", theme },
      message: `Theme set to ${theme}.`,
    };
  }

  const mode = MODE_ALIASES[arg];
  if (mode) {
    return {
      ok: true,
      patch: { kind: "mode", mode },
      message: `Mode set to ${mode}.`,
    };
  }

  return {
    ok: false,
    message: `Unknown theme "${arg}". Try hermes, claw, knot, dash, system, light, or dark.`,
  };
}

export const TEXT_SCALE_STOPS = [90, 100, 110, 125] as const;
export type TextScaleStop = (typeof TEXT_SCALE_STOPS)[number];

export function normalizeTextScale(value: unknown): TextScaleStop {
  if (typeof value !== "number") {
    return 100;
  }
  return TEXT_SCALE_STOPS.includes(value as TextScaleStop) ? (value as TextScaleStop) : 100;
}
