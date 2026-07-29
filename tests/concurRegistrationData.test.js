import { describe, it, expect } from "vitest";
import { buildConcurRegistrationData } from "../src/lib/concurRegistrationData.js";

function buildCompany(overrides = {}) {
  // company_idの実体はcompany_code（迷子防止Bot内部の会社スラッグ）であり、
  // Supabaseの内部UUIDではない（src/lib/concurRegistrationData.js冒頭コメント参照）。
  return { company_id: "sample-company", company_name: "サンプル会社", ...overrides };
}

function buildResult(overrides = {}) {
  return {
    rule: { id: "r002-g1" },
    ...overrides,
    expenseType: {
      id: "taxi",
      name: "タクシー",
      policyId: "normal_expense",
      receiptRequired: false,
      ...overrides.expenseType,
    },
  };
}

function buildReceiptData(overrides = {}) {
  return {
    transactionDate: "2026-07-29",
    merchantName: "株式会社あんしんネット21",
    totalAmount: 1200,
    currencyCode: "JPY",
    confidence: { transactionDate: 0.98, merchantName: 0.95, totalAmount: 0.97 },
    ...overrides,
  };
}

describe("buildConcurRegistrationData（正常系）", () => {
  it("company_code・policyId・経費タイプID（＝Concur EXP_KEY）・OCRデータから期待する統合データを生成する", () => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult(),
      receiptData: buildReceiptData(),
    });

    expect(error).toBeNull();
    expect(result).toEqual({
      companyId: "sample-company",
      policyId: "normal_expense",
      expenseTypeId: "taxi",
      transactionDate: "2026-07-29",
      amount: 1200,
      currencyCode: "JPY",
      vendorName: "株式会社あんしんネット21",
      receiptRequired: false,
      memo: null,
    });
  });

  it("memoを指定した場合はそのまま含まれる（自動生成しない）", () => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult(),
      receiptData: buildReceiptData(),
      memo: "タクシー代（〇〇社訪問）",
    });

    expect(error).toBeNull();
    expect(result.memo).toBe("タクシー代（〇〇社訪問）");
  });

  it("memo未指定の場合はnull（ダミー文字列を生成しない）", () => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult(),
      receiptData: buildReceiptData(),
    });

    expect(error).toBeNull();
    expect(result.memo).toBeNull();
  });

  it("領収書必須の経費タイプでも、領収書ファイルがあれば通る", () => {
    const receiptFile = new File(["dummy"], "receipt.png", { type: "image/png" });

    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult({ expenseType: { receiptRequired: true } }),
      receiptData: buildReceiptData(),
      receiptFile,
    });

    expect(error).toBeNull();
    expect(result.receiptRequired).toBe(true);
    // 領収書画像自体は中間データに含めない。
    expect(result).not.toHaveProperty("receiptFile");
  });

  it("経費タイプIDが変わればそのまま異なるexpenseTypeIdになる（Mapping層を経由しない）", () => {
    const taxiResult = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult({ expenseType: { id: "01515" } }),
      receiptData: buildReceiptData(),
    });
    const otherResult = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult({ expenseType: { id: "01516" } }),
      receiptData: buildReceiptData(),
    });

    expect(taxiResult.result.expenseTypeId).toBe("01515");
    expect(otherResult.result.expenseTypeId).toBe("01516");
  });
});

describe("buildConcurRegistrationData（異常系）", () => {
  it("company_codeが欠落している場合はmissing_company_id", () => {
    const { result, error } = buildConcurRegistrationData({
      company: null,
      result: buildResult(),
      receiptData: buildReceiptData(),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("missing_company_id");
  });

  it("company.company_idが空文字の場合もmissing_company_id", () => {
    const { error } = buildConcurRegistrationData({
      company: buildCompany({ company_id: "" }),
      result: buildResult(),
      receiptData: buildReceiptData(),
    });

    expect(error.type).toBe("missing_company_id");
  });

  it("policyId（result.expenseType.policyId）が欠落している場合はmissing_policy_id（補完しない）", () => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult({ expenseType: { policyId: undefined } }),
      receiptData: buildReceiptData(),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("missing_policy_id");
  });

  it("経費タイプID（result.expenseType.id）が欠落している場合は、既存のvalidateConcurExpenseData()のmissing_expense_typeを再利用する", () => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult({ expenseType: { id: undefined } }),
      receiptData: buildReceiptData(),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("missing_expense_type");
  });

  it("transactionDateが欠落している場合は、既存のvalidateConcurExpenseData()のmissing_transaction_dateを再利用する", () => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult(),
      receiptData: buildReceiptData({ transactionDate: null }),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("missing_transaction_date");
  });

  it.each([
    [null, "invalid_amount"],
    [0, "invalid_amount"],
    [-500, "invalid_amount"],
    ["1000", "invalid_amount"],
  ])("amountが不正(%s)な場合は、既存のvalidateConcurExpenseData()のinvalid_amountを再利用する", (totalAmount, expectedType) => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult(),
      receiptData: buildReceiptData({ totalAmount }),
    });

    expect(result).toBeNull();
    expect(error.type).toBe(expectedType);
  });

  it("currencyCodeが欠落している場合は、既存のvalidateConcurExpenseData()のmissing_currency_codeを再利用する", () => {
    const { result, error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult(),
      receiptData: buildReceiptData({ currencyCode: null }),
    });

    expect(result).toBeNull();
    expect(error.type).toBe("missing_currency_code");
  });

  it("領収書必須なのに領収書ファイルが無い場合は、既存のvalidateConcurExpenseData()のreceipt_required_but_missingを再利用する", () => {
    const { error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult({ expenseType: { receiptRequired: true } }),
      receiptData: buildReceiptData(),
      receiptFile: null,
    });

    expect(error.type).toBe("receipt_required_but_missing");
  });

  it("複数の問題が同時にある場合はcompanyId欠落が最優先で報告される", () => {
    const { error } = buildConcurRegistrationData({
      company: null,
      result: buildResult({ expenseType: { policyId: undefined, id: undefined } }),
      receiptData: buildReceiptData({ transactionDate: null, currencyCode: null }),
    });

    expect(error.type).toBe("missing_company_id");
  });

  it("companyIdはあるがpolicyIdが無い場合はpolicyId欠落が優先される（transactionDate等より先）", () => {
    const { error } = buildConcurRegistrationData({
      company: buildCompany(),
      result: buildResult({ expenseType: { policyId: undefined } }),
      receiptData: buildReceiptData({ transactionDate: null, currencyCode: null }),
    });

    expect(error.type).toBe("missing_policy_id");
  });

  it("引数を何も渡さなくても例外にならずmissing_company_idを返す", () => {
    const { result, error } = buildConcurRegistrationData();

    expect(result).toBeNull();
    expect(error.type).toBe("missing_company_id");
  });
});
