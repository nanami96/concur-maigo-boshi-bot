import { describe, it, expect } from "vitest";
import { validateConcurQuickExpenseResponse } from "../supabase/functions/_shared/concur-quick-expense/validateConcurQuickExpenseResponse.js";

describe("validateConcurQuickExpenseResponse（正常系）", () => {
  it("quickExpenseIdUriがあればok:trueで値を返す", () => {
    const uri = "https://us.api.concursolutions.com/quickexpense/v4/users/dummy-user-id/context/TRAVELER/quickexpenses/dummy-id";
    const result = validateConcurQuickExpenseResponse({ quickExpenseIdUri: uri });

    expect(result).toEqual({ ok: true, quickExpenseIdUri: uri });
  });
});

describe("validateConcurQuickExpenseResponse（異常系）", () => {
  it("quickExpenseIdUriが無い場合はconcur_quick_expense_invalid_response", () => {
    const result = validateConcurQuickExpenseResponse({});
    expect(result).toEqual({ ok: false, code: "concur_quick_expense_invalid_response" });
  });

  it("quickExpenseIdUriが空文字・空白のみの場合はconcur_quick_expense_invalid_response", () => {
    expect(validateConcurQuickExpenseResponse({ quickExpenseIdUri: "" }).ok).toBe(false);
    expect(validateConcurQuickExpenseResponse({ quickExpenseIdUri: "   " }).ok).toBe(false);
  });

  it("quickExpenseIdUriが文字列以外の型の場合はconcur_quick_expense_invalid_response", () => {
    expect(validateConcurQuickExpenseResponse({ quickExpenseIdUri: 12345 }).ok).toBe(false);
    expect(validateConcurQuickExpenseResponse({ quickExpenseIdUri: null }).ok).toBe(false);
  });

  it("bodyがnull・配列・非オブジェクトの場合はconcur_quick_expense_invalid_response（例外にならない）", () => {
    expect(validateConcurQuickExpenseResponse(null).ok).toBe(false);
    expect(validateConcurQuickExpenseResponse(undefined).ok).toBe(false);
    expect(validateConcurQuickExpenseResponse([]).ok).toBe(false);
    expect(validateConcurQuickExpenseResponse("not-an-object").ok).toBe(false);
  });
});
