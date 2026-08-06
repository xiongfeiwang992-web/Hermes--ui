// Hermes UI settings — persisted appearance preferences.
import { parseThemeSelection, type ThemeMode, type ThemeName } from "./theme.ts";

export const SETTINGS_KEY = "hermes.ui.settings.v1";

export type HermesSettings = {
  theme: ThemeName;
  themeMode: ThemeMode;
  textScale: number;
};

export const DEFAULT_SETTINGS: HermesSettings = {
  theme: "hermes",
  themeMode: "system",
  textScale: 100,
};

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(): HermesSettings {
  const storage = getStorage();
  if (!storage) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<HermesSettings>;
    const { theme, mode } = parseThemeSelection(parsed.theme, parsed.themeMode);
    const textScale =
      typeof parsed.textScale === "number" && parsed.textScale >= 80 && parsed.textScale <= 150
        ? parsed.textScale
        : DEFAULT_SETTINGS.textScale;

    return { theme, themeMode: mode, textScale };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(next: HermesSettings): HermesSettings {
  const storage = getStorage();
  const normalized = {
    theme: next.theme,
    themeMode: next.themeMode,
    textScale: next.textScale,
  };
  storage?.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function patchSettings(patch: Partial<HermesSettings>): HermesSettings {
  return saveSettings({ ...loadSettings(), ...patch });
}
