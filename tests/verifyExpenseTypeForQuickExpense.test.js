import { describe, it, expect } from "vitest";
import { verifyExpenseTypeForQuickExpense } from "../supabase/functions/create-concur-quick-expense/verifyExpenseTypeForQuickExpense.js";

// 経費タイプID（Concur EXP_KEY）の値はすべてテスト専用のダミー値であり、
// 実際のConcur側のコードではない。

function buildExpenseTypes(overrides = []) {
  return [
    { id: "01515", policyId: "normal_expense", name: "国内近距離バス", active: true },
    { id: "01516", policyId: "normal_expense", name: "タクシー", active: true },
    { id: "01518", policyId: "business_trip", name: "新幹線", active: true },
    ...overrides,
  ];
}

function buildInput(overrides = {}) {
  return {
    expenseTypes: buildExpenseTypes(),
    expenseTypeId: "01515",
    policyId: "normal_expense",
    ...overrides,
  };
}

describe("verifyExpenseTypeForQuickExpense 正常系", () => {
  it("expenseTypeIdが存在し、policyIdが一致し、使用停止でなければvalid", () => {
    expect(verifyExpenseTypeForQuickExpense(buildInput())).toEqual({ valid: true, reason: null });
  });
});

describe("verifyExpenseTypeForQuickExpense 異常系", () => {
  it("存在しないexpenseTypeIdはnot_found", () => {
    const result = verifyExpenseTypeForQuickExpense(buildInput({ expenseTypeId: "99999" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("policyIdが一致しない場合はnot_found（改ざん検出、詳細を区別しない）", () => {
    const result = verifyExpenseTypeForQuickExpense(buildInput({ policyId: "business_trip" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("使用停止（active: false）の経費タイプはnot_found", () => {
    const expenseTypes = buildExpenseTypes([{ id: "00001", policyId: "normal_expense", name: "廃止済み", active: false }]);
    const result = verifyExpenseTypeForQuickExpense({ expenseTypes, expenseTypeId: "00001", policyId: "normal_expense" });
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("expenseTypesが0件の場合はnot_found", () => {
    const result = verifyExpenseTypeForQuickExpense(buildInput({ expenseTypes: [] }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("expenseTypesがundefinedの場合もnot_found（例外にならない）", () => {
    const result = verifyExpenseTypeForQuickExpense(buildInput({ expenseTypes: undefined }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("expenseTypesが配列でない（型不正な設定データ）場合もnot_found（例外にならない）", () => {
    const result = verifyExpenseTypeForQuickExpense(buildInput({ expenseTypes: "not-an-array" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("expenseTypesがnullの場合もnot_found（例外にならない）", () => {
    const result = verifyExpenseTypeForQuickExpense(buildInput({ expenseTypes: null }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("expenseTypeId・policyIdが空文字の場合もnot_found", () => {
    const result = verifyExpenseTypeForQuickExpense(buildInput({ expenseTypeId: "", policyId: "" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("経費タイプ要素自体が壊れた形（null混入等）でも例外にならない", () => {
    const result = verifyExpenseTypeForQuickExpense(
      buildInput({ expenseTypes: [null, undefined, {}, ...buildExpenseTypes()] }),
    );
    expect(result).toEqual({ valid: true, reason: null });
  });

  it("他社（別会社）の経費タイプ一覧しか存在しない場合はnot_found（他社設定の流用不可）", () => {
    const result = verifyExpenseTypeForQuickExpense({
      expenseTypes: [{ id: "01515", policyId: "other_policy", name: "別ポリシー", active: true }],
      expenseTypeId: "01515",
      policyId: "normal_expense",
    });
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });
});
