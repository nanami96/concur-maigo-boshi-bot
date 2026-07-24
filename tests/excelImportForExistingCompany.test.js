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
});
