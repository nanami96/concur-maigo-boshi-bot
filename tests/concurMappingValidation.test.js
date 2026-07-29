import { describe, it, expect } from "vitest";
import {
  validateConcurExpenseTypeMappingInput,
  resolvePolicyName,
  resolveExpenseTypeName,
  shouldConfirmExpenseTypePolicyChange,
} from "../src/lib/concurMappingValidation.js";

// mappingの値（Concur Expense Type Code）はすべてテスト専用のダミー値であり、
// 実際のConcur側のコードではない。

function buildPolicies() {
  return [
    { policy_id: "normal_expense", policy_name: "通常経費", enabled: "Y" },
    { policy_id: "business_trip", policy_name: "出張経費", enabled: "Y" },
  ];
}

function buildExpenseTypes() {
  return [
    { id: "taxi", policyId: "normal_expense", name: "タクシー", receiptRequired: true, active: true },
    { id: "trip_type", policyId: "business_trip", name: "出張費", receiptRequired: true, active: true },
  ];
}

function baseInput(overrides = {}) {
  return {
    companyId: "sample-company",
    policyId: "normal_expense",
    botExpenseTypeId: "taxi",
    concurExpenseTypeId: "TEST_TAXI",
    policies: buildPolicies(),
    expenseTypes: buildExpenseTypes(),
    existingMappings: [],
    ...overrides,
  };
}

describe("validateConcurExpenseTypeMappingInput 正常系", () => {
  it("正しい入力なら、trim済みのmappingオブジェクトを返す", () => {
    const { error, mapping } = validateConcurExpenseTypeMappingInput(baseInput());
    expect(error).toBeNull();
    expect(mapping).toEqual({
      companyId: "sample-company",
      policyId: "normal_expense",
      botExpenseTypeId: "taxi",
      concurExpenseTypeId: "TEST_TAXI",
    });
  });

  it("Concur Expense Type Codeの前後空白はtrimされる", () => {
    const { error, mapping } = validateConcurExpenseTypeMappingInput(
      baseInput({ concurExpenseTypeId: "  TEST_TAXI  " }),
    );
    expect(error).toBeNull();
    expect(mapping.concurExpenseTypeId).toBe("TEST_TAXI");
  });
});

describe("validateConcurExpenseTypeMappingInput 異常系", () => {
  it("ポリシー未選択はpolicy_requiredエラー", () => {
    const { error } = validateConcurExpenseTypeMappingInput(baseInput({ policyId: "" }));
    expect(error.type).toBe("policy_required");
  });

  it("存在しないポリシーIDはpolicy_unknownエラー", () => {
    const { error } = validateConcurExpenseTypeMappingInput(baseInput({ policyId: "does_not_exist" }));
    expect(error.type).toBe("policy_unknown");
  });

  it("経費タイプ未選択はexpense_type_requiredエラー", () => {
    const { error } = validateConcurExpenseTypeMappingInput(baseInput({ botExpenseTypeId: "" }));
    expect(error.type).toBe("expense_type_required");
  });

  it("存在しない経費タイプIDはexpense_type_unknownエラー", () => {
    const { error } = validateConcurExpenseTypeMappingInput(baseInput({ botExpenseTypeId: "does_not_exist" }));
    expect(error.type).toBe("expense_type_unknown");
  });

  it("選択した経費タイプが指定ポリシーに属していない場合はpolicy_expense_type_mismatchエラー", () => {
    const { error } = validateConcurExpenseTypeMappingInput(
      baseInput({ policyId: "business_trip", botExpenseTypeId: "taxi" }),
    );
    expect(error.type).toBe("policy_expense_type_mismatch");
  });

  it("Concur Expense Type Code未入力はconcur_code_requiredエラー", () => {
    const { error } = validateConcurExpenseTypeMappingInput(baseInput({ concurExpenseTypeId: "" }));
    expect(error.type).toBe("concur_code_required");
  });

  it("Concur Expense Type Codeが空白のみでもconcur_code_requiredエラー（trimして判定）", () => {
    const { error } = validateConcurExpenseTypeMappingInput(baseInput({ concurExpenseTypeId: "   " }));
    expect(error.type).toBe("concur_code_required");
  });

  it("同じcompanyId+policyId+botExpenseTypeIdが既存mappingに存在する場合はduplicate_mappingエラー", () => {
    const { error } = validateConcurExpenseTypeMappingInput(
      baseInput({
        existingMappings: [
          { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_EXISTING" },
        ],
      }),
    );
    expect(error.type).toBe("duplicate_mapping");
  });

  it("excludeKeyを指定すると、自分自身は重複判定から除外される（編集時の自己重複誤検知を防ぐ）", () => {
    const existing = { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_OLD" };
    const { error } = validateConcurExpenseTypeMappingInput(
      baseInput({
        concurExpenseTypeId: "TEST_NEW",
        existingMappings: [existing],
        excludeKey: { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi" },
      }),
    );
    expect(error).toBeNull();
  });

  it("excludeKeyを指定していても、別の行との重複は検出される", () => {
    const existing = { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_OTHER" };
    const { error } = validateConcurExpenseTypeMappingInput(
      baseInput({
        existingMappings: [existing],
        // excludeKeyは別の(架空の)行を指しており、existingとは一致しない
        excludeKey: { companyId: "sample-company", policyId: "business_trip", botExpenseTypeId: "trip_type" },
      }),
    );
    expect(error.type).toBe("duplicate_mapping");
  });
});

describe("resolvePolicyName / resolveExpenseTypeName", () => {
  it("既知のIDなら名称を返す", () => {
    expect(resolvePolicyName(buildPolicies(), "normal_expense")).toBe("通常経費");
    expect(resolveExpenseTypeName(buildExpenseTypes(), "taxi")).toBe("タクシー");
  });

  it("未知のID（参照先が削除された等）でも例外にならず、IDそのものを返す", () => {
    expect(resolvePolicyName(buildPolicies(), "does_not_exist")).toBe("does_not_exist");
    expect(resolveExpenseTypeName(buildExpenseTypes(), "does_not_exist")).toBe("does_not_exist");
  });

  it("policies/expenseTypesが未指定でも例外にならない", () => {
    expect(resolvePolicyName(undefined, "p1")).toBe("p1");
    expect(resolveExpenseTypeName(undefined, "e1")).toBe("e1");
  });
});

describe("shouldConfirmExpenseTypePolicyChange", () => {
  it("Concurマッピングから参照されていない経費タイプは、ポリシー変更時に確認不要", () => {
    expect(
      shouldConfirmExpenseTypePolicyChange({
        currentPolicyId: "normal_expense",
        nextPolicyId: "business_trip",
        concurMappingUsage: 0,
      }),
    ).toBe(false);
  });

  it("Concurマッピングから参照されている経費タイプは、ポリシー変更時に確認が必要", () => {
    expect(
      shouldConfirmExpenseTypePolicyChange({
        currentPolicyId: "normal_expense",
        nextPolicyId: "business_trip",
        concurMappingUsage: 1,
      }),
    ).toBe(true);
  });

  it("複数のConcurマッピングから参照されている場合も確認が必要", () => {
    expect(
      shouldConfirmExpenseTypePolicyChange({
        currentPolicyId: "normal_expense",
        nextPolicyId: "business_trip",
        concurMappingUsage: 3,
      }),
    ).toBe(true);
  });

  it("ポリシーIDを実際には変更しない場合は、マッピングの有無に関わらず確認不要", () => {
    expect(
      shouldConfirmExpenseTypePolicyChange({
        currentPolicyId: "normal_expense",
        nextPolicyId: "normal_expense",
        concurMappingUsage: 5,
      }),
    ).toBe(false);
  });

  it("concurMappingUsageが未指定（undefined）でも例外にならず確認不要になる", () => {
    expect(
      shouldConfirmExpenseTypePolicyChange({
        currentPolicyId: "normal_expense",
        nextPolicyId: "business_trip",
        concurMappingUsage: undefined,
      }),
    ).toBe(false);
  });
});
