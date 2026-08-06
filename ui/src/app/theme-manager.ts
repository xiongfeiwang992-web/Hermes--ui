// Hermes UI theme manager — runtime theme state with system-mode listener.
import { loadSettings, patchSettings, type HermesSettings } from "./settings.ts";
import { parseThemeCommand, normalizeTextScale } from "./theme-command.ts";
import { startThemeTransition } from "./theme-transition.ts";
import {
  applyThemePresentation,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
  type ThemeName,
} from "./theme.ts";

export type ThemeManager = {
  get settings(): HermesSettings;
  get resolved(): ResolvedTheme;
  setTheme(theme: ThemeName, element?: HTMLElement | null): void;
  setThemeMode(mode: ThemeMode, element?: HTMLElement | null): void;
  setTextScale(textScale: number, element?: HTMLElement | null): void;
  applyCommand(input: string): { ok: boolean; message: string };
  refresh(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

export function createThemeManager(initialSettings = loadSettings()): ThemeManager {
  let settings = initialSettings;
  let systemThemeCleanup: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const publish = () => {
    applyThemePresentation(settings);
    for (const listener of listeners) {
      listener();
    }
  };

  const detachSystemThemeListener = () => {
    systemThemeCleanup?.();
    systemThemeCleanup = undefined;
  };

  const syncSystemThemeListener = () => {
    detachSystemThemeListener();
    if (settings.themeMode !== "system" || typeof globalThis.matchMedia !== "function") {
      return;
    }

    const mediaQuery = globalThis.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (settings.themeMode === "system") {
        publish();
      }
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      systemThemeCleanup = () => mediaQuery.removeEventListener("change", onChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(onChange);
      systemThemeCleanup = () => mediaQuery.removeListener(onChange);
    }
  };

  const transitionTo = (
    next: HermesSettings,
    element?: HTMLElement | null,
  ) => {
    const currentTheme = resolveTheme(settings.theme, settings.themeMode);
    const nextTheme = resolveTheme(next.theme, next.themeMode);
    startThemeTransition({
      currentTheme,
      nextTheme,
      context: { element },
      applyTheme: () => {
        settings = patchSettings(next);
        publish();
        syncSystemThemeListener();
      },
    });
  };

  syncSystemThemeListener();
  publish();

  return {
    get settings() {
      return settings;
    },
    get resolved() {
      return resolveTheme(settings.theme, settings.themeMode);
    },
    setTheme(theme, element) {
      transitionTo({ ...settings, theme }, element);
    },
    setThemeMode(mode, element) {
      transitionTo({ ...settings, themeMode: mode }, element);
    },
    setTextScale(textScale, element) {
      transitionTo({ ...settings, textScale: normalizeTextScale(textScale) }, element);
    },
    applyCommand(input) {
      const result = parseThemeCommand(input);
      if (!result) {
        return { ok: false, message: "Not a theme command." };
      }
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      if (result.patch.kind === "theme") {
        this.setTheme(result.patch.theme);
      } else {
        this.setThemeMode(result.patch.mode);
      }
      return { ok: true, message: result.message };
    },
    refresh() {
      settings = loadSettings();
      publish();
      syncSystemThemeListener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      detachSystemThemeListener();
      listeners.clear();
    },
  };
}
