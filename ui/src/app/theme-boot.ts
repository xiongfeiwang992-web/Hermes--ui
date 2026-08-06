// Hermes UI — early boot theme resolution (before app bundle loads).
import { parseThemeSelection, resolveTheme, type ResolvedTheme, type ThemeMode, type ThemeName } from "./theme.ts";

export type BootThemePresentation = {
  resolved: ResolvedTheme;
  resolvedMode: "light" | "dark";
};

export function resolveBootTheme(theme: ThemeName, themeMode: ThemeMode): BootThemePresentation {
  const resolved = resolveTheme(theme, themeMode);
  return {
    resolved,
    resolvedMode: resolved.endsWith("light") ? "light" : "dark",
  };
}

export function resolveBootThemeFromStorage(raw: unknown): BootThemePresentation | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as { theme?: unknown; themeMode?: unknown };
  const { theme, mode } = parseThemeSelection(record.theme, record.themeMode);
  return resolveBootTheme(theme, mode);
}

export function applyBootThemePresentation(presentation: BootThemePresentation): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-theme", presentation.resolved);
  root.setAttribute("data-theme-mode", presentation.resolvedMode);
  root.setAttribute("data-theme-resolved", presentation.resolvedMode);
  root.style.colorScheme = presentation.resolvedMode;
}

export function applyBootThemeFromRawSettings(raw: unknown): BootThemePresentation | null {
  const presentation = resolveBootThemeFromStorage(raw);
  if (!presentation) {
    return null;
  }
  applyBootThemePresentation(presentation);
  return presentation;
}
