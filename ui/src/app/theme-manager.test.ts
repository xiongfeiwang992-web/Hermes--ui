// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY } from "./settings.ts";
import { createThemeManager } from "./theme-manager.ts";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-mode");
  document.documentElement.removeAttribute("data-theme-resolved");
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
});

describe("createThemeManager", () => {
  it("applies Hermes theme to the document on boot", () => {
    const manager = createThemeManager();
    expect(document.documentElement.dataset.theme).toBe("hermes");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(manager.resolved).toBe("hermes");
    manager.dispose();
  });

  it("persists theme changes through settings storage", () => {
    const manager = createThemeManager();
    manager.setTheme("claw");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(JSON.parse(storage.get(SETTINGS_KEY) ?? "{}").theme).toBe("claw");
    manager.dispose();
  });

  it("notifies subscribers when theme mode changes", () => {
    const manager = createThemeManager();
    const listener = vi.fn();
    manager.subscribe(listener);
    manager.setThemeMode("light");
    expect(listener).toHaveBeenCalled();
    expect(document.documentElement.dataset.themeMode).toBe("light");
    manager.dispose();
  });

  it("applies /theme commands", () => {
    const manager = createThemeManager();
    const result = manager.applyCommand("/theme claw");
    expect(result.ok).toBe(true);
    expect(manager.settings.theme).toBe("claw");
    manager.dispose();
  });
});
