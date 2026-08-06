// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, patchSettings, saveSettings, SETTINGS_KEY } from "./settings.ts";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
});

describe("settings", () => {
  it("returns Hermes defaults when storage is empty", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists theme and mode updates", () => {
    saveSettings({ theme: "dash", themeMode: "light", textScale: 110 });
    expect(loadSettings()).toEqual({
      theme: "dash",
      themeMode: "light",
      textScale: 110,
    });
    expect(JSON.parse(storage.get(SETTINGS_KEY) ?? "{}")).toEqual({
      theme: "dash",
      themeMode: "light",
      textScale: 110,
    });
  });

  it("normalizes invalid stored values", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({ theme: "unknown", themeMode: "nope", textScale: 999 }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("patches partial settings", () => {
    saveSettings(DEFAULT_SETTINGS);
    expect(patchSettings({ themeMode: "dark" })).toEqual({
      ...DEFAULT_SETTINGS,
      themeMode: "dark",
    });
  });
});
