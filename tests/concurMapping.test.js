import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { createConcurExpenseTypeMappings } from "../scripts/generators/concurMapping";

// mappingの値（Concur Expense Type Code）はすべてテスト専用のダミー値であり、
// 実際のConcur側のコードではない。

function buildWorkbook(sheetsData) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheetsData).forEach(([name, rows]) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  });
  return workbook;
}

function buildWorkbookWithMapping(rows) {
  return buildWorkbook({
    "07_Concurマッピング": [["ポリシーID", "経費タイプID", "Concur Expense Type Code"], ...rows],
  });
}

const COMPANY = { company_id: "sample-company" };
const POLICIES = [{ policy_id: "normal_expense" }, { policy_id: "business_trip" }];
const EXPENSE_TYPES = [{ id: "train_local" }, { id: "taxi" }, { id: "bullet_train" }];

describe("createConcurExpenseTypeMappings 正常系", () => {
  it("正常な1件を生成できる（companyIdはExcelの列ではなく会社設定から補完される）", () => {
    const workbook = buildWorkbookWithMapping([["normal_expense", "train_local", "TEST_TRAIN_LOCAL"]]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(errors).toEqual([]);
    expect(concurExpenseTypeMappings).toEqual([
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "train_local", concurExpenseTypeId: "TEST_TRAIN_LOCAL" },
    ]);
  });

  it("複数件を生成できる", () => {
    const workbook = buildWorkbookWithMapping([
      ["normal_expense", "train_local", "TEST_TRAIN_LOCAL"],
      ["normal_expense", "taxi", "TEST_TAXI"],
      ["business_trip", "bullet_train", "TEST_BULLET_TRAIN"],
    ]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(errors).toEqual([]);
    expect(concurExpenseTypeMappings).toHaveLength(3);
    expect(concurExpenseTypeMappings).toContainEqual({
      companyId: "sample-company", policyId: "business_trip", botExpenseTypeId: "bullet_train", concurExpenseTypeId: "TEST_BULLET_TRAIN",
    });
  });

  it("空シート（ヘッダー行のみ、データ行が無い）の場合は空配列・エラー無し", () => {
    const workbook = buildWorkbookWithMapping([]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(concurExpenseTypeMappings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("空行（全列が空欄の行）は無視される", () => {
    const workbook = buildWorkbookWithMapping([
      ["normal_expense", "train_local", "TEST_TRAIN_LOCAL"],
      ["", "", ""],
      ["normal_expense", "taxi", "TEST_TAXI"],
    ]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(errors).toEqual([]);
    expect(concurExpenseTypeMappings).toHaveLength(2);
  });

  it("既存config生成結果への回帰がない：07_Concurマッピングシート自体が無い会社（company-a相当）は空配列・エラー無し", () => {
    const workbook = buildWorkbook({
      "01_基本設定": [["会社ID", "会社名"], ["company-a", "A株式会社"]],
    });

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: { company_id: "company-a" },
      policies: [],
      expenseTypes: [],
    });

    expect(concurExpenseTypeMappings).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("createConcurExpenseTypeMappings 異常系", () => {
  it("必須項目（ポリシーID・経費タイプID・Concur Expense Type Codeのいずれか）が不足している行はエラーになる", () => {
    const workbook = buildWorkbookWithMapping([["", "train_local", "TEST_TRAIN_LOCAL"]]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(concurExpenseTypeMappings).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("ポリシーID");
  });

  it("concurExpenseTypeId（Concur Expense Type Code）が空欄の行はエラーになる", () => {
    const workbook = buildWorkbookWithMapping([["normal_expense", "train_local", ""]]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(concurExpenseTypeMappings).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Concur Expense Type Code");
  });

  it("同一ポリシーID・経費タイプIDの組み合わせが重複している場合はエラーになる", () => {
    const workbook = buildWorkbookWithMapping([
      ["normal_expense", "train_local", "TEST_TRAIN_LOCAL"],
      ["normal_expense", "train_local", "TEST_TRAIN_LOCAL_DUP"],
    ]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(concurExpenseTypeMappings).toEqual([
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "train_local", concurExpenseTypeId: "TEST_TRAIN_LOCAL" },
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("重複");
  });

  it("02_ポリシーに存在しないポリシーIDが指定された行はエラーになる", () => {
    const workbook = buildWorkbookWithMapping([["not_a_real_policy", "train_local", "TEST_TRAIN_LOCAL"]]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(concurExpenseTypeMappings).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("not_a_real_policy");
    expect(errors[0]).toContain("02_ポリシー");
  });

  it("03_経費タイプに存在しない経費タイプIDが指定された行はエラーになる", () => {
    const workbook = buildWorkbookWithMapping([["normal_expense", "not_a_real_expense_type", "TEST_CODE"]]);

    const { concurExpenseTypeMappings, errors } = createConcurExpenseTypeMappings({
      workbook,
      company: COMPANY,
      policies: POLICIES,
      expenseTypes: EXPENSE_TYPES,
    });

    expect(concurExpenseTypeMappings).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("not_a_real_expense_type");
    expect(errors[0]).toContain("03_経費タイプ");
  });
});
