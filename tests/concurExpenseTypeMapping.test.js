import { describe, it, expect } from "vitest";
import { mapBotExpenseTypeToConcur, mappingMatchesKey } from "../src/lib/concurExpenseTypeMapping.js";

function buildMappings(overrides = []) {
  return [
    { companyId: "company-a", policyId: "policy-x", botExpenseTypeId: "taxi", concurExpenseTypeId: "CONCUR_TAXI_A_X" },
    { companyId: "company-a", policyId: "policy-y", botExpenseTypeId: "taxi", concurExpenseTypeId: "CONCUR_TAXI_A_Y" },
    { companyId: "company-a", policyId: "policy-x", botExpenseTypeId: "hotel", concurExpenseTypeId: "CONCUR_HOTEL_A_X" },
    { companyId: "company-b", policyId: "policy-z", botExpenseTypeId: "taxi", concurExpenseTypeId: "CONCUR_TAXI_B_Z" },
    ...overrides,
  ];
}

describe("mapBotExpenseTypeToConcur", () => {
  it("会社・ポリシー・経費タイプが一致する行から識別子を返す", () => {
    const { result, error } = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-a",
      policyId: "policy-x",
      mappings: buildMappings(),
    });

    expect(error).toBeNull();
    expect(result).toEqual({ concurExpenseTypeId: "CONCUR_TAXI_A_X" });
  });

  it("同じbotExpenseTypeIdでも会社・ポリシーが違えば異なる識別子を返す", () => {
    const mappings = buildMappings();

    const resultAX = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-a",
      policyId: "policy-x",
      mappings,
    }).result;
    const resultAY = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-a",
      policyId: "policy-y",
      mappings,
    }).result;
    const resultBZ = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-b",
      policyId: "policy-z",
      mappings,
    }).result;

    expect(resultAX.concurExpenseTypeId).toBe("CONCUR_TAXI_A_X");
    expect(resultAY.concurExpenseTypeId).toBe("CONCUR_TAXI_A_Y");
    expect(resultBZ.concurExpenseTypeId).toBe("CONCUR_TAXI_B_Z");
  });

  it("会社が未知の場合はcompany_unknownエラー", () => {
    const { result, error } = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-unknown",
      policyId: "policy-x",
      mappings: buildMappings(),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("company_unknown");
  });

  it("会社は既知だがポリシーが未知の場合はpolicy_unknownエラー", () => {
    const { error } = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-a",
      policyId: "policy-unknown",
      mappings: buildMappings(),
    });

    expect(error.type).toBe("policy_unknown");
  });

  it("会社・ポリシーは既知だが経費タイプに該当するマッピングが無い場合はmapping_not_foundエラー", () => {
    const { error } = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "unknown-expense-type",
      companyId: "company-a",
      policyId: "policy-x",
      mappings: buildMappings(),
    });

    expect(error.type).toBe("mapping_not_found");
  });

  it("同じ会社・ポリシー・経費タイプの組み合わせが複数登録されている場合はmultiple_mappings_foundエラー", () => {
    const mappings = buildMappings([
      { companyId: "company-a", policyId: "policy-x", botExpenseTypeId: "taxi", concurExpenseTypeId: "DUPLICATE_ENTRY" },
    ]);

    const { result, error } = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-a",
      policyId: "policy-x",
      mappings,
    });

    expect(result).toBeNull();
    expect(error.type).toBe("multiple_mappings_found");
  });

  it("mappingsが空配列の場合はcompany_unknownエラー", () => {
    const { error } = mapBotExpenseTypeToConcur({
      botExpenseTypeId: "taxi",
      companyId: "company-a",
      policyId: "policy-x",
      mappings: [],
    });

    expect(error.type).toBe("company_unknown");
  });

  it("mappingsが配列でない（未指定・不正な形）場合も例外にならずcompany_unknownエラーになる", () => {
    expect(
      mapBotExpenseTypeToConcur({
        botExpenseTypeId: "taxi",
        companyId: "company-a",
        policyId: "policy-x",
        mappings: undefined,
      }).error.type,
    ).toBe("company_unknown");

    expect(
      mapBotExpenseTypeToConcur({
        botExpenseTypeId: "taxi",
        companyId: "company-a",
        policyId: "policy-x",
        mappings: null,
      }).error.type,
    ).toBe("company_unknown");
  });

  it("companyId・policyIdが未指定(undefined)の場合もcompany_unknown/policy_unknownとして扱う", () => {
    expect(
      mapBotExpenseTypeToConcur({
        botExpenseTypeId: "taxi",
        companyId: undefined,
        policyId: "policy-x",
        mappings: buildMappings(),
      }).error.type,
    ).toBe("company_unknown");

    expect(
      mapBotExpenseTypeToConcur({
        botExpenseTypeId: "taxi",
        companyId: "company-a",
        policyId: undefined,
        mappings: buildMappings(),
      }).error.type,
    ).toBe("policy_unknown");
  });
});

describe("mappingMatchesKey", () => {
  it("companyId・policyId・botExpenseTypeIdが全て一致すればtrue", () => {
    const entry = { companyId: "company-a", policyId: "policy-x", botExpenseTypeId: "taxi", concurExpenseTypeId: "X" };
    expect(
      mappingMatchesKey(entry, { companyId: "company-a", policyId: "policy-x", botExpenseTypeId: "taxi" }),
    ).toBe(true);
  });

  it("いずれか1つでも異なればfalse", () => {
    const entry = { companyId: "company-a", policyId: "policy-x", botExpenseTypeId: "taxi", concurExpenseTypeId: "X" };
    expect(
      mappingMatchesKey(entry, { companyId: "company-b", policyId: "policy-x", botExpenseTypeId: "taxi" }),
    ).toBe(false);
    expect(
      mappingMatchesKey(entry, { companyId: "company-a", policyId: "policy-y", botExpenseTypeId: "taxi" }),
    ).toBe(false);
    expect(
      mappingMatchesKey(entry, { companyId: "company-a", policyId: "policy-x", botExpenseTypeId: "hotel" }),
    ).toBe(false);
  });

  it("entry・keyがnull/undefinedでも例外にならずfalseになる", () => {
    expect(mappingMatchesKey(null, { companyId: "a", policyId: "b", botExpenseTypeId: "c" })).toBe(false);
    expect(mappingMatchesKey({ companyId: "a" }, undefined)).toBe(false);
  });
});
