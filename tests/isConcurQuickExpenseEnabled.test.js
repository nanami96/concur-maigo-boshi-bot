import { describe, it, expect } from "vitest";
import { isConcurQuickExpenseEnabled } from "../supabase/functions/create-concur-quick-expense/isConcurQuickExpenseEnabled.js";

describe("isConcurQuickExpenseEnabled", () => {
  it('CONCUR_QUICK_EXPENSE_ENABLEDが厳密に文字列"true"の場合だけtrue', () => {
    expect(isConcurQuickExpenseEnabled({ CONCUR_QUICK_EXPENSE_ENABLED: "true" })).toBe(true);
  });

  it.each([
    [undefined, "未設定（envにキー自体が無い）"],
    ["", "空文字"],
    ["false", "false"],
    ["False", "大文字小文字違い（False）"],
    ["TRUE", "大文字小文字違い（TRUE）"],
    [true, "真偽値true（文字列でない）"],
    ["1", "その他の文字列（1）"],
    ["yes", "その他の文字列（yes）"],
    [" true", "前後に空白を含む文字列"],
  ])("CONCUR_QUICK_EXPENSE_ENABLEDが%s（%s）の場合はfalse", (value) => {
    expect(isConcurQuickExpenseEnabled({ CONCUR_QUICK_EXPENSE_ENABLED: value })).toBe(false);
  });

  it("envオブジェクト自体がnull・undefinedでも例外にならずfalse", () => {
    expect(isConcurQuickExpenseEnabled(null)).toBe(false);
    expect(isConcurQuickExpenseEnabled(undefined)).toBe(false);
  });

  it("envにCONCUR_QUICK_EXPENSE_ENABLEDキー自体が無い場合もfalse", () => {
    expect(isConcurQuickExpenseEnabled({})).toBe(false);
  });
});
