import { describe, it, expect, beforeEach } from "vitest";
import { normalizeText } from "../src/classifier/normalize";
import { resetMetrics } from "../src/classifier/metrics";

describe("normalizeText", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("lowercases Ukrainian text", () => {
    expect(normalizeText("Напиши функцію")).toBe("напиши функцію");
  });

  it("lowercases English text", () => {
    expect(normalizeText("Write Function")).toBe("write function");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeText("Write  Function")).toBe("write function");
  });

  it("collapses multiple Unicode spaces", () => {
    // \u0020 = regular space, \u00A0 = non-breaking space
    const input = "Реалізуй API\u0020\u0020\u0020endpoint";
    expect(normalizeText(input)).toBe("реалізуй api endpoint");
  });

  it("converts curly double quotes to straight", () => {
    expect(normalizeText("«Create» модуль")).toBe('"create" модуль');
  });

  it("converts en dash to hyphen", () => {
    expect(normalizeText("Write – implement")).toBe("write - implement");
  });

  it("converts em dash to hyphen", () => {
    expect(normalizeText("Write — create")).toBe("write - create");
  });

  it("converts mixed curly single quotes to straight", () => {
    expect(normalizeText("It's a test")).toBe("it's a test");
  });

  it("converts backtick to apostrophe", () => {
    expect(normalizeText("`quoted`")).toBe("'quoted'");
  });

  it("collapses three or more spaces to one", () => {
    expect(normalizeText("hello   world")).toBe("hello world");
  });

  it("trims leading and trailing spaces", () => {
    expect(normalizeText("  trim  spaces  ")).toBe("trim spaces");
  });

  it("converts Cyrillic ё to е (Russian text)", () => {
    expect(normalizeText("всё хорошо")).toBe("все хорошо");
  });

  it("preserves Ukrainian і/ї/є/ґ", () => {
    expect(normalizeText("інформація")).toBe("інформація");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });

  it("handles string with only whitespace", () => {
    expect(normalizeText("   \t\n   ")).toBe("");
  });

  it("handles string with no normalization needed", () => {
    expect(normalizeText("hello world")).toBe("hello world");
  });

  it("handles Unicode fancy quotes and dashes together", () => {
    expect(normalizeText("«Test» — hello")).toBe('"test" - hello');
  });

  it("handles all quote variants to straight double quote", () => {
    // „ (U+201E), " (U+201C), " (U+201D), „ (U+201F)
    const input = "\u201Ehello\u201C world\u201D";
    expect(normalizeText(input)).toBe('"hello" world"');
  });
});
