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

// mappingの値（Concur Expense Type Code）はすべてテスト専用のダミー値であり、
// 実際のConcur側のコードではない。
describe("checkMasterData: Concurマッピング", () => {
  it("concurExpenseTypeMappingsが未指定（既存会社）でもエラーにならない", () => {
    const { errors, warnings } = checkMasterData(baseState());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("concurExpenseTypeMappingsが空配列であること自体はエラーにしない（Concur未使用の会社が存在するため）", () => {
    const { errors } = checkMasterData(baseState({ concurExpenseTypeMappings: [] }));
    expect(errors).toEqual([]);
  });

  it("一部の経費タイプにmappingが無いこと自体はエラーにしない（Concur対象範囲は未確定のため）", () => {
    const { errors } = checkMasterData(
      baseState({
        expenseTypes: [
          { id: "taxi", policyId: "normal_expense", name: "タクシー", receiptRequired: true, active: true },
          { id: "train", policyId: "normal_expense", name: "電車", receiptRequired: false, active: true },
        ],
        concurExpenseTypeMappings: [
          { companyId: "test-co", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
        ],
      }),
    );
    expect(errors).toEqual([]);
  });

  it("正常なmappingが1件あってもエラーにならない", () => {
    const { errors } = checkMasterData(
      baseState({
        concurExpenseTypeMappings: [
          { companyId: "test-co", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
        ],
      }),
    );
    expect(errors).toEqual([]);
  });

  it("存在しないpolicyIdを参照しているmappingはError", () => {
    const { errors } = checkMasterData(
      baseState({
        concurExpenseTypeMappings: [
          { companyId: "test-co", policyId: "does_not_exist", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "concur-mapping-policy-missing-0")).toBe(true);
  });

  it("存在しないbotExpenseTypeIdを参照しているmappingはError", () => {
    const { errors } = checkMasterData(
      baseState({
        concurExpenseTypeMappings: [
          { companyId: "test-co", policyId: "normal_expense", botExpenseTypeId: "does_not_exist", concurExpenseTypeId: "TEST_TAXI" },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "concur-mapping-expense-type-missing-0")).toBe(true);
  });

  it("policyIdと経費タイプの実際のpolicyIdが一致しない場合はError", () => {
    const { errors } = checkMasterData(
      baseState({
        policies: [
          { policy_id: "normal_expense", policy_name: "通常経費", enabled: "Y" },
          { policy_id: "business_trip", policy_name: "出張経費", enabled: "Y" },
        ],
        concurExpenseTypeMappings: [
          { companyId: "test-co", policyId: "business_trip", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "concur-mapping-policy-mismatch-0")).toBe(true);
  });

  it("concurExpenseTypeIdが空のmappingはError", () => {
    const { errors } = checkMasterData(
      baseState({
        concurExpenseTypeMappings: [
          { companyId: "test-co", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "" },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "concur-mapping-code-empty-0")).toBe(true);
  });

  it("companyId+policyId+botExpenseTypeIdが重複しているmappingはError", () => {
    const { errors } = checkMasterData(
      baseState({
        concurExpenseTypeMappings: [
          { companyId: "test-co", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_1" },
          { companyId: "test-co", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_2" },
        ],
      }),
    );
    expect(errors.some((e) => e.id === "concur-mapping-duplicate-1")).toBe(true);
  });
});
