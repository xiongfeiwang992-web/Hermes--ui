// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { parseThemeSelection, resolveTheme } from "./theme.ts";

describe("resolveTheme", () => {
  it("resolves Hermes as the default family", () => {
    expect(resolveTheme("hermes", "dark")).toBe("hermes");
    expect(resolveTheme("hermes", "light")).toBe("hermes-light");
  });

  it("resolves named theme families when mode is provided", () => {
    expect(resolveTheme("knot", "dark")).toBe("openknot");
    expect(resolveTheme("dash", "light")).toBe("dash-light");
  });

  it("uses system preference when mode is system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveTheme("hermes", "system")).toBe("hermes-light");
    vi.unstubAllGlobals();
  });
});

describe("parseThemeSelection", () => {
  it("falls back to Hermes defaults for unknown stored values", () => {
    expect(parseThemeSelection("unknown", "invalid-mode")).toEqual({
      theme: "hermes",
      mode: "system",
    });
    expect(parseThemeSelection("dash", "light")).toEqual({
      theme: "dash",
      mode: "light",
    });
  });
});
