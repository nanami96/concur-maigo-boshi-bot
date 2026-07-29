import { describe, it, expect } from "vitest";
import { checkMasterData } from "../src/flow/masterDataChecks";
import { createEmptyFlow } from "../src/flow/flowMutations";

function baseState(overrides = {}) {
  return {
    company: { company_id: "test-co", company_name: "テスト会社" },
    policies: [{ policy_id: "normal_expense", policy_name: "通常経費", enabled: "Y" }],
    expenseTypes: [
      { id: "taxi", policyId: "normal_expense", name: "タクシー", receiptRequired: true, active: true },
    ],
    flow: createEmptyFlow(),
    ...overrides,
  };
}

describe("checkMasterData", () => {
  it("正常な状態ではError/Warningともに0件", () => {
    const { errors, warnings } = checkMasterData(baseState());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("会社名未設定はError", () => {
    const { errors } = checkMasterData(baseState({ company: { company_id: "x", company_name: "" } }));
    expect(errors.some((e) => e.id === "company-name-required")).toBe(true);
  });

  it("ポリシーID重複はError", () => {
    const { errors } = checkMasterData(
      baseState({
        policies: [
          { policy_id: "p1", policy_name: "A", enabled: "Y" },
          { policy_id: "p1", policy_name: "B", enabled: "Y" },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "policy-id-dup-p1")).toBe(true);
  });

  it("ポリシー名未設定はError", () => {
    const { errors } = checkMasterData(
      baseState({ policies: [{ policy_id: "p1", policy_name: "", enabled: "Y" }] }),
    );
    expect(errors.some((e) => e.id === "policy-name-required-p1")).toBe(true);
  });

  it("経費タイプID重複はError", () => {
    const { errors } = checkMasterData(
      baseState({
        expenseTypes: [
          { id: "taxi", policyId: "normal_expense", name: "タクシー", receiptRequired: true, active: true },
          { id: "taxi", policyId: "normal_expense", name: "タクシー2", receiptRequired: true, active: true },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "expense-id-dup-taxi")).toBe(true);
  });

  it("経費タイプ名未設定はError", () => {
    const { errors } = checkMasterData(
      baseState({
        expenseTypes: [
          { id: "taxi", policyId: "normal_expense", name: "", receiptRequired: true, active: true },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "expense-name-required-taxi")).toBe(true);
  });

  it("存在しないポリシー参照はError", () => {
    const { errors } = checkMasterData(
      baseState({
        expenseTypes: [
          { id: "taxi", policyId: "does_not_exist", name: "タクシー", receiptRequired: true, active: true },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "expense-policy-missing-taxi")).toBe(true);
  });

  it("使用停止ポリシーに使用中の経費タイプがあるとWarning", () => {
    const { warnings } = checkMasterData(
      baseState({
        policies: [{ policy_id: "normal_expense", policy_name: "通常経費", enabled: "N" }],
      }),
    );
    expect(warnings.some((w) => w.id === "expense-policy-disabled-taxi")).toBe(true);
  });

  it("領収書要否未設定(null)はWarning", () => {
    const { warnings } = checkMasterData(
      baseState({
        expenseTypes: [
          { id: "taxi", policyId: "normal_expense", name: "タクシー", receiptRequired: null, active: true },
        ],
      }),
    );
    expect(warnings.some((w) => w.id === "expense-receipt-unset-taxi")).toBe(true);
  });

  it("使用停止経費タイプが質問フローの結果で参照されているとWarning", () => {
    const flow = {
      rootQuestionId: "Q001",
      questions: { Q001: { text: "Q", optionIds: ["O001"] } },
      options: {
        O001: { label: "タクシー", next: { type: "result", candidates: [{ expenseTypeId: "taxi" }] } },
      },
    };
    const { warnings } = checkMasterData(
      baseState({
        expenseTypes: [
          { id: "taxi", policyId: "normal_expense", name: "タクシー", receiptRequired: true, active: false },
        ],
        flow,
      }),
    );
    expect(warnings.some((w) => w.id === "expense-disabled-in-use-taxi")).toBe(true);
  });
});
