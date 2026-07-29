import { describe, it, expect } from "vitest";
import { verifyConcurExpenseTypeMapping } from "../supabase/functions/create-concur-quick-expense/verifyConcurExpenseTypeMapping.js";

// mappingの値（Concur Expense Type Code）はすべてテスト専用のダミー値であり、
// 実際のConcur側のコードではない。

function buildMappings(overrides = []) {
  return [
    { companyId: "company-a", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_A" },
    { companyId: "company-a", policyId: "normal_expense", botExpenseTypeId: "train_local", concurExpenseTypeId: "TEST_TRAIN_A" },
    { companyId: "company-b", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_B" },
    ...overrides,
  ];
}

function buildInput(overrides = {}) {
  return {
    mappings: buildMappings(),
    companyId: "company-a",
    policyId: "normal_expense",
    botExpenseTypeId: "taxi",
    concurExpenseTypeId: "TEST_TAXI_A",
    ...overrides,
  };
}

describe("verifyConcurExpenseTypeMapping 正常系", () => {
  it("companyId・policyId・botExpenseTypeId・concurExpenseTypeIdの4項目が完全一致する行が1件あればvalid", () => {
    expect(verifyConcurExpenseTypeMapping(buildInput())).toEqual({ valid: true, reason: null });
  });
});

describe("verifyConcurExpenseTypeMapping 異常系", () => {
  it("companyIdが一致しない場合はnot_found", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ companyId: "company-x" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("policyIdが一致しない場合はnot_found", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ policyId: "business_trip" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("botExpenseTypeIdが一致しない場合はnot_found", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ botExpenseTypeId: "hotel" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("3キーは一致するがconcurExpenseTypeIdだけが異なる場合もnot_found（フロント申告値の改ざん・不整合検出）", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ concurExpenseTypeId: "FORGED_CODE" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("mappingが0件の場合はnot_found", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ mappings: [] }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("mappingsがundefinedの場合もnot_found（例外にならない）", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ mappings: undefined }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("mappingsが配列でない（型不正な設定データ）場合もnot_found（例外にならない）", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ mappings: "not-an-array" }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("mappingsがnullの場合もnot_found（例外にならない）", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ mappings: null }));
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("同じcompanyId・policyId・botExpenseTypeIdの行が複数存在する場合はconflict（設定不整合、安全側で拒否）", () => {
    const duplicated = buildMappings([
      { companyId: "company-a", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_A_DUP" },
    ]);
    const result = verifyConcurExpenseTypeMapping(buildInput({ mappings: duplicated }));
    expect(result).toEqual({ valid: false, reason: "conflict" });
  });

  it("他社（company-b）のmappingしか存在しない場合はnot_found（他社設定の流用不可）", () => {
    const result = verifyConcurExpenseTypeMapping(
      buildInput({ mappings: [{ companyId: "company-b", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_B" }] }),
    );
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("companyId・policyId・botExpenseTypeId・concurExpenseTypeIdが空文字の場合もnot_found", () => {
    const result = verifyConcurExpenseTypeMapping(
      buildInput({ companyId: "", policyId: "", botExpenseTypeId: "", concurExpenseTypeId: "" }),
    );
    expect(result).toEqual({ valid: false, reason: "not_found" });
  });

  it("mapping要素自体が壊れた形（null混入等）でも例外にならない", () => {
    const result = verifyConcurExpenseTypeMapping(buildInput({ mappings: [null, undefined, {}, ...buildMappings()] }));
    expect(result).toEqual({ valid: true, reason: null });
  });
});
