// Hermes UI theme transition — immediate apply, no animation lag.
import type { ResolvedTheme } from "./theme.ts";

export type ThemeTransitionContext = {
  element?: HTMLElement | null;
  pointerClientX?: number;
  pointerClientY?: number;
};

type ThemeTransitionOptions = {
  nextTheme: ResolvedTheme;
  applyTheme: () => void;
  context?: ThemeTransitionContext;
  currentTheme?: ResolvedTheme | null;
};

const cleanupThemeTransition = (root: HTMLElement) => {
  root.classList.remove("theme-transition");
  root.style.removeProperty("--theme-switch-x");
  root.style.removeProperty("--theme-switch-y");
};

export function startThemeTransition({
  nextTheme,
  applyTheme,
  currentTheme,
}: ThemeTransitionOptions): void {
  if (currentTheme === nextTheme) {
    applyTheme();
    return;
  }

  const documentReference = globalThis.document ?? null;
  if (!documentReference) {
    applyTheme();
    return;
  }

  applyTheme();
  cleanupThemeTransition(documentReference.documentElement);
}
