import { describe, it, expect } from "vitest";
import { classifyConcurQuickExpenseHttpStatus } from "../supabase/functions/_shared/concur-quick-expense/classifyConcurQuickExpenseHttpStatus.js";

describe("classifyConcurQuickExpenseHttpStatus（成功系）", () => {
  it("201はnull（エラーではない）", () => {
    expect(classifyConcurQuickExpenseHttpStatus(201)).toBeNull();
  });

  it("2xx全般はnull", () => {
    expect(classifyConcurQuickExpenseHttpStatus(200)).toBeNull();
    expect(classifyConcurQuickExpenseHttpStatus(204)).toBeNull();
  });
});

describe("classifyConcurQuickExpenseHttpStatus（公式ドキュメントに明記されたステータス）", () => {
  it("400はconcur_quick_expense_invalid_request", () => {
    expect(classifyConcurQuickExpenseHttpStatus(400)).toBe("concur_quick_expense_invalid_request");
  });

  it("403はconcur_quick_expense_rejected", () => {
    expect(classifyConcurQuickExpenseHttpStatus(403)).toBe("concur_quick_expense_rejected");
  });

  it("429はconcur_quick_expense_rate_limited", () => {
    expect(classifyConcurQuickExpenseHttpStatus(429)).toBe("concur_quick_expense_rate_limited");
  });

  it("500はconcur_quick_expense_service_error", () => {
    expect(classifyConcurQuickExpenseHttpStatus(500)).toBe("concur_quick_expense_service_error");
  });
});

describe("classifyConcurQuickExpenseHttpStatus（未文書化・防御的な分類）", () => {
  it("401はconcur_quick_expense_rejected（このエンドポイント固有の文書には無いが防御的に403と同じ扱い）", () => {
    expect(classifyConcurQuickExpenseHttpStatus(401)).toBe("concur_quick_expense_rejected");
  });

  it("404・409はconcur_quick_expense_invalid_response（未文書化の4xx）", () => {
    expect(classifyConcurQuickExpenseHttpStatus(404)).toBe("concur_quick_expense_invalid_response");
    expect(classifyConcurQuickExpenseHttpStatus(409)).toBe("concur_quick_expense_invalid_response");
  });

  it("502・503・504はconcur_quick_expense_service_error（500系はまとめて防御的に扱う）", () => {
    expect(classifyConcurQuickExpenseHttpStatus(502)).toBe("concur_quick_expense_service_error");
    expect(classifyConcurQuickExpenseHttpStatus(503)).toBe("concur_quick_expense_service_error");
    expect(classifyConcurQuickExpenseHttpStatus(504)).toBe("concur_quick_expense_service_error");
  });

  it("3xxや数値以外はconcur_quick_expense_invalid_response（想定外の応答）", () => {
    expect(classifyConcurQuickExpenseHttpStatus(301)).toBe("concur_quick_expense_invalid_response");
    expect(classifyConcurQuickExpenseHttpStatus(undefined)).toBe("concur_quick_expense_invalid_response");
    expect(classifyConcurQuickExpenseHttpStatus("400")).toBe("concur_quick_expense_invalid_response");
  });
});
