import { describe, it, expect } from "vitest";
import { sanitizeDigitsOnly } from "../src/lib/numericInput.js";

describe("sanitizeDigitsOnly", () => {
  it("数字だけの文字列はそのまま返す", () => {
    expect(sanitizeDigitsOnly("1200")).toBe("1200");
  });

  it("数字以外の文字（e・+・-・.等）を取り除く", () => {
    expect(sanitizeDigitsOnly("1e5")).toBe("15");
    expect(sanitizeDigitsOnly("+1200")).toBe("1200");
    expect(sanitizeDigitsOnly("-1200")).toBe("1200");
    expect(sanitizeDigitsOnly("12.5")).toBe("125");
  });

  it("全角数字・記号・空白等も数字以外として除去する", () => {
    expect(sanitizeDigitsOnly("１２００円")).toBe("");
    expect(sanitizeDigitsOnly("1,200")).toBe("1200");
    expect(sanitizeDigitsOnly("1 200")).toBe("1200");
  });

  it("空文字・null・undefinedは空文字を返す（例外にならない）", () => {
    expect(sanitizeDigitsOnly("")).toBe("");
    expect(sanitizeDigitsOnly(null)).toBe("");
    expect(sanitizeDigitsOnly(undefined)).toBe("");
  });
});
