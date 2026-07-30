import { describe, it, expect } from "vitest";
import { buildConcurQuickExpenseError } from "../supabase/functions/_shared/concur-quick-expense/classifyConcurQuickExpenseError.js";

const KNOWN_CODES = [
  "concur_quick_expense_invalid_request",
  "concur_quick_expense_geolocation_missing",
  "concur_quick_expense_rejected",
  "concur_quick_expense_rate_limited",
  "concur_quick_expense_service_error",
  "concur_quick_expense_invalid_response",
  "concur_quick_expense_timeout",
  "concur_quick_expense_network_error",
];

describe("buildConcurQuickExpenseError", () => {
  it.each(KNOWN_CODES)("%sは固定のcode・messageを返す", (code) => {
    const result = buildConcurQuickExpenseError(code);
    expect(result.code).toBe(code);
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("未知のcodeでも既定メッセージを返す（例外にならない）", () => {
    const result = buildConcurQuickExpenseError("unknown_code");
    expect(result.code).toBe("unknown_code");
    expect(result.message).toBe("Concur経費登録の処理でエラーが発生しました。");
  });

  it("メッセージはすべて固定文言のみで、Concur側の生データを含まない", () => {
    for (const code of KNOWN_CODES) {
      const { message } = buildConcurQuickExpenseError(code);
      expect(message).not.toContain("http");
      expect(message).not.toContain("Error");
    }
  });
});
