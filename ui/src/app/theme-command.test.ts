// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeTextScale, parseThemeCommand } from "./theme-command.ts";

describe("parseThemeCommand", () => {
  it("returns null for non-theme input", () => {
    expect(parseThemeCommand("hello")).toBeNull();
  });

  it("parses theme names", () => {
    expect(parseThemeCommand("/theme hermes")).toEqual({
      ok: true,
      patch: { kind: "theme", theme: "hermes" },
      message: "Theme set to hermes.",
    });
    expect(parseThemeCommand("/theme claw")).toEqual({
      ok: true,
      patch: { kind: "theme", theme: "claw" },
      message: "Theme set to claw.",
    });
  });

  it("parses mode names", () => {
    expect(parseThemeCommand("/theme dark")).toEqual({
      ok: true,
      patch: { kind: "mode", mode: "dark" },
      message: "Mode set to dark.",
    });
  });

  it("reports usage for bare /theme", () => {
    expect(parseThemeCommand("/theme")).toEqual({
      ok: false,
      message: "Usage: /theme <hermes|claw|knot|dash|system|light|dark>",
    });
  });
});

describe("normalizeTextScale", () => {
  it("keeps supported stops and falls back to 100", () => {
    expect(normalizeTextScale(125)).toBe(125);
    expect(normalizeTextScale(999)).toBe(100);
  });
});
