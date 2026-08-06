export { SETTINGS_KEY, DEFAULT_SETTINGS, loadSettings, saveSettings, patchSettings } from "./app/settings.ts";
export type { HermesSettings } from "./app/settings.ts";

export {
  parseThemeSelection,
  resolveTheme,
  applyThemeToDocument,
  applyThemePresentation,
  THEME_OPTIONS,
  THEME_MODE_OPTIONS,
} from "./app/theme.ts";
export type { ThemeName, ThemeMode, ResolvedTheme } from "./app/theme.ts";

export { createThemeManager } from "./app/theme-manager.ts";
export type { ThemeManager } from "./app/theme-manager.ts";

export {
  resolveBootTheme,
  resolveBootThemeFromStorage,
  applyBootThemePresentation,
  applyBootThemeFromRawSettings,
} from "./app/theme-boot.ts";
export type { BootThemePresentation } from "./app/theme-boot.ts";

export {
  parseThemeCommand,
  normalizeTextScale,
  TEXT_SCALE_STOPS,
} from "./app/theme-command.ts";
export type { ThemeCommandPatch, ThemeCommandResult, TextScaleStop } from "./app/theme-command.ts";

export { startThemeTransition } from "./app/theme-transition.ts";
export type { ThemeTransitionContext } from "./app/theme-transition.ts";
