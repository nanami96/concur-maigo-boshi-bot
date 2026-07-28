import { describe, it, expect } from "vitest";
import {
  detectCompanyIdMismatch,
  buildWorkspaceStateFromImport,
} from "../src/admin/excelImportForExistingCompany";

describe("detectCompanyIdMismatch", () => {
  it("会社IDが一致する場合はfalse", () => {
    expect(
      detectCompanyIdMismatch({ parsedCompanyId: "sample-company", currentCompanyId: "sample-company" }),
    ).toBe(false);
  });

  it("会社IDが異なる場合はtrue", () => {
    expect(
      detectCompanyIdMismatch({ parsedCompanyId: "other-company", currentCompanyId: "sample-company" }),
    ).toBe(true);
  });

  it("Excel側の会社IDが空の場合はfalse（未設定として扱い、不一致とはしない）", () => {
    expect(detectCompanyIdMismatch({ parsedCompanyId: "", currentCompanyId: "sample-company" })).toBe(
      false,
    );
    expect(
      detectCompanyIdMismatch({ parsedCompanyId: undefined, currentCompanyId: "sample-company" }),
    ).toBe(false);
  });

  it("現在の会社IDが空の場合はfalse", () => {
    expect(detectCompanyIdMismatch({ parsedCompanyId: "sample-company", currentCompanyId: "" })).toBe(
      false,
    );
  });
});

describe("buildWorkspaceStateFromImport", () => {
  it("company_idを常に現在の会社のものへ固定する（Excel側の値は使わない）", () => {
    const bundle = {
      company: { company_id: "excel-company-id", company_name: "Excelの会社名" },
      policies: [{ policy_id: "p1", policy_name: "通常経費", enabled: "Y" }],
      expenseTypes: [{ id: "e1", name: "交通費", active: true }],
      flow: { questions: {}, options: {}, rootQuestionId: null },
    };

    const result = buildWorkspaceStateFromImport({ bundle, currentCompanyId: "sample-company" });

    expect(result.company.company_id).toBe("sample-company");
  });

  it("会社名はExcelの内容で更新される", () => {
    const bundle = {
      company: { company_id: "excel-company-id", company_name: "Excelの会社名" },
      policies: [],
      expenseTypes: [],
      flow: { questions: {}, options: {}, rootQuestionId: null },
    };

    const result = buildWorkspaceStateFromImport({ bundle, currentCompanyId: "sample-company" });

    expect(result.company.company_name).toBe("Excelの会社名");
  });

  it("policies/expenseTypesが未指定でも空配列にフォールバックする", () => {
    const bundle = {
      company: { company_id: "x", company_name: "テスト会社" },
      flow: { questions: {}, options: {}, rootQuestionId: null },
    };

    const result = buildWorkspaceStateFromImport({ bundle, currentCompanyId: "sample-company" });

    expect(result.policies).toEqual([]);
    expect(result.expenseTypes).toEqual([]);
  });

  it("policies/expenseTypes/flowはExcelの内容をそのまま反映する", () => {
    const policies = [{ policy_id: "p1", policy_name: "通常経費", enabled: "Y" }];
    const expenseTypes = [{ id: "e1", name: "交通費", active: true }];
    const flow = { questions: { q1: {} }, options: {}, rootQuestionId: "q1" };
    const bundle = {
      company: { company_id: "excel-company-id", company_name: "テスト会社" },
      policies,
      expenseTypes,
      flow,
    };

    const result = buildWorkspaceStateFromImport({ bundle, currentCompanyId: "sample-company" });

    expect(result.policies).toBe(policies);
    expect(result.expenseTypes).toBe(expenseTypes);
    expect(result.flow).toBe(flow);
  });

  // mappingの値はすべてテスト専用のダミー値であり、実際のConcur側のコードではない。
  describe("concurExpenseTypeMappings（07_Concurマッピングシートの有無で扱いが変わる）", () => {
    const baseBundle = {
      company: { company_id: "excel-company-id", company_name: "テスト会社" },
      policies: [],
      expenseTypes: [],
      flow: { questions: {}, options: {}, rootQuestionId: null },
    };
    const existingMappings = [
      { companyId: "sample-company", policyId: "p1", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_EXISTING" },
    ];
    const importedMappings = [
      { companyId: "sample-company", policyId: "p1", botExpenseTypeId: "train_local", concurExpenseTypeId: "TEST_TRAIN_NEW" },
    ];

    it("07_Concurマッピングシートが無いExcelを再インポートしても、既存のmappingは変更されない", () => {
      const bundle = { ...baseBundle, hasConcurMappingSheet: false, concurExpenseTypeMappings: [] };

      const result = buildWorkspaceStateFromImport({
        bundle,
        currentCompanyId: "sample-company",
        currentConcurExpenseTypeMappings: existingMappings,
      });

      expect(result.concurExpenseTypeMappings).toBe(existingMappings);
    });

    it("07_Concurマッピングシートがある場合は、Excelの内容へ置き換える", () => {
      const bundle = { ...baseBundle, hasConcurMappingSheet: true, concurExpenseTypeMappings: importedMappings };

      const result = buildWorkspaceStateFromImport({
        bundle,
        currentCompanyId: "sample-company",
        currentConcurExpenseTypeMappings: existingMappings,
      });

      expect(result.concurExpenseTypeMappings).toBe(importedMappings);
    });

    it("07_Concurマッピングシートがあっても空（データ行なし）の場合は、空配列へ置き換える（既存mappingは残らない）", () => {
      const bundle = { ...baseBundle, hasConcurMappingSheet: true, concurExpenseTypeMappings: [] };

      const result = buildWorkspaceStateFromImport({
        bundle,
        currentCompanyId: "sample-company",
        currentConcurExpenseTypeMappings: existingMappings,
      });

      expect(result.concurExpenseTypeMappings).toEqual([]);
    });

    it("currentConcurExpenseTypeMappings省略時・シート無しでも例外にならず空配列になる", () => {
      const bundle = { ...baseBundle, hasConcurMappingSheet: false, concurExpenseTypeMappings: [] };

      const result = buildWorkspaceStateFromImport({ bundle, currentCompanyId: "sample-company" });

      expect(result.concurExpenseTypeMappings).toEqual([]);
    });

    it("hasConcurMappingSheet自体が無い古い呼び出し方（bundleにフィールドが無い）でも既存mappingを維持する", () => {
      const bundle = { ...baseBundle };

      const result = buildWorkspaceStateFromImport({
        bundle,
        currentCompanyId: "sample-company",
        currentConcurExpenseTypeMappings: existingMappings,
      });

      expect(result.concurExpenseTypeMappings).toBe(existingMappings);
    });
  });
});
