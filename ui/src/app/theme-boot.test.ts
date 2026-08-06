// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyBootThemeFromRawSettings, resolveBootTheme } from "./theme-boot.ts";

describe("theme-boot", () => {
  it("resolves Hermes boot presentation for dark mode", () => {
    expect(resolveBootTheme("hermes", "dark")).toEqual({
      resolved: "hermes",
      resolvedMode: "dark",
    });
  });

  it("resolves Hermes boot presentation for light mode", () => {
    expect(resolveBootTheme("hermes", "light")).toEqual({
      resolved: "hermes-light",
      resolvedMode: "light",
    });
  });

  it("applies boot attributes from stored settings", () => {
    document.documentElement.removeAttribute("data-theme");
    const presentation = applyBootThemeFromRawSettings({
      theme: "dash",
      themeMode: "light",
    });
    expect(presentation).toEqual({
      resolved: "dash-light",
      resolvedMode: "light",
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dash-light");
    expect(document.documentElement.getAttribute("data-theme-mode")).toBe("light");
  });
});
