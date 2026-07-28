import { describe, it, expect } from "vitest";
import { buildConcurExpenseData, validateConcurExpenseData } from "../src/lib/concurExpenseData.js";

function buildOcrResult(overrides = {}) {
  return {
    transactionDate: "2026-07-14",
    merchantName: "株式会社あんしんネット21",
    totalAmount: 1000,
    currencyCode: "JPY",
    confidence: { transactionDate: 0.98, merchantName: 0.95, totalAmount: 0.97 },
    ...overrides,
  };
}

function buildJudgmentResult(overrides = {}) {
  return {
    rule: { id: "r002-g1" },
    expenseType: { id: "taxi", name: "タクシー", receiptRequired: true, ...overrides.expenseType },
  };
}

describe("buildConcurExpenseData", () => {
  it("OCR結果と判定結果から共通経費データを組み立てる", () => {
    const receiptFile = new File(["dummy"], "receipt.png", { type: "image/png" });

    const result = buildConcurExpenseData({
      ocrResult: buildOcrResult(),
      judgmentResult: buildJudgmentResult(),
      receiptFile,
    });

    expect(result).toEqual({
      transactionDate: "2026-07-14",
      amount: 1000,
      currencyCode: "JPY",
      vendorName: "株式会社あんしんネット21",
      expenseTypeId: "taxi",
      receiptRequired: true,
      receiptFile,
    });
  });

  it("ocrResultがnullの場合はOCR由来のフィールドがすべてnullになる", () => {
    const result = buildConcurExpenseData({
      ocrResult: null,
      judgmentResult: buildJudgmentResult(),
    });

    expect(result.transactionDate).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.currencyCode).toBeNull();
    expect(result.vendorName).toBeNull();
    expect(result.expenseTypeId).toBe("taxi");
    expect(result.receiptRequired).toBe(true);
  });

  it("judgmentResultがnullの場合は判定結果由来のフィールドがすべてnullになる", () => {
    const result = buildConcurExpenseData({
      ocrResult: buildOcrResult(),
      judgmentResult: null,
    });

    expect(result.expenseTypeId).toBeNull();
    expect(result.receiptRequired).toBeNull();
    expect(result.transactionDate).toBe("2026-07-14");
  });

  it("judgmentResultが複数候補（candidates）のみでexpenseTypeが未確定の場合もnullになる", () => {
    const result = buildConcurExpenseData({
      ocrResult: buildOcrResult(),
      judgmentResult: { candidates: [buildJudgmentResult(), buildJudgmentResult()] },
    });

    expect(result.expenseTypeId).toBeNull();
    expect(result.receiptRequired).toBeNull();
  });

  it("receiptFileを省略した場合はnullになる", () => {
    const result = buildConcurExpenseData({
      ocrResult: buildOcrResult(),
      judgmentResult: buildJudgmentResult(),
    });

    expect(result.receiptFile).toBeNull();
  });

  it("引数を何も渡さない場合もエラーにならず全項目nullを返す", () => {
    const result = buildConcurExpenseData();

    expect(result).toEqual({
      transactionDate: null,
      amount: null,
      currencyCode: null,
      vendorName: null,
      expenseTypeId: null,
      receiptRequired: null,
      receiptFile: null,
    });
  });
});

function buildValidExpenseData(overrides = {}) {
  return {
    transactionDate: "2026-07-14",
    amount: 1000,
    currencyCode: "JPY",
    vendorName: "株式会社あんしんネット21",
    expenseTypeId: "taxi",
    receiptRequired: false,
    receiptFile: null,
    ...overrides,
  };
}

describe("validateConcurExpenseData", () => {
  it("必須項目がすべて揃っていればエラー無しでresultにそのまま返す", () => {
    const data = buildValidExpenseData();
    const { result, error } = validateConcurExpenseData(data);

    expect(error).toBeNull();
    expect(result).toEqual(data);
  });

  it("領収書必須でも画像が添付されていれば通る", () => {
    const receiptFile = new File(["dummy"], "receipt.png", { type: "image/png" });
    const data = buildValidExpenseData({ receiptRequired: true, receiptFile });
    const { result, error } = validateConcurExpenseData(data);

    expect(error).toBeNull();
    expect(result.receiptFile).toBe(receiptFile);
  });

  it("receiptRequiredが未設定(null)で画像が無くてもエラーにしない（必須と確定していないため）", () => {
    const data = buildValidExpenseData({ receiptRequired: null, receiptFile: null });
    const { error } = validateConcurExpenseData(data);

    expect(error).toBeNull();
  });

  it("利用日が無ければmissing_transaction_dateエラー", () => {
    const data = buildValidExpenseData({ transactionDate: null });
    const { result, error } = validateConcurExpenseData(data);

    expect(result).toBeNull();
    expect(error.type).toBe("missing_transaction_date");
  });

  it("金額が無ければinvalid_amountエラー", () => {
    const data = buildValidExpenseData({ amount: null });
    const { error } = validateConcurExpenseData(data);

    expect(error.type).toBe("invalid_amount");
    expect(error.message).toContain("入力されていません");
  });

  it("金額が0以下ならinvalid_amountエラー", () => {
    expect(validateConcurExpenseData(buildValidExpenseData({ amount: 0 })).error.type).toBe(
      "invalid_amount",
    );
    expect(validateConcurExpenseData(buildValidExpenseData({ amount: -500 })).error.type).toBe(
      "invalid_amount",
    );
  });

  it("金額が数値でなければinvalid_amountエラー", () => {
    const data = buildValidExpenseData({ amount: "1000" });
    const { error } = validateConcurExpenseData(data);

    expect(error.type).toBe("invalid_amount");
    expect(error.message).toContain("数値ではありません");
  });

  it("金額がNaNならinvalid_amountエラー", () => {
    const data = buildValidExpenseData({ amount: Number.NaN });
    const { error } = validateConcurExpenseData(data);

    expect(error.type).toBe("invalid_amount");
  });

  it("通貨コードが無ければmissing_currency_codeエラー", () => {
    const data = buildValidExpenseData({ currencyCode: null });
    const { error } = validateConcurExpenseData(data);

    expect(error.type).toBe("missing_currency_code");
  });

  it("経費タイプが未判定ならmissing_expense_typeエラー", () => {
    const data = buildValidExpenseData({ expenseTypeId: null });
    const { error } = validateConcurExpenseData(data);

    expect(error.type).toBe("missing_expense_type");
  });

  it("領収書必須なのに画像が無ければreceipt_required_but_missingエラー", () => {
    const data = buildValidExpenseData({ receiptRequired: true, receiptFile: null });
    const { error } = validateConcurExpenseData(data);

    expect(error.type).toBe("receipt_required_but_missing");
  });

  it("複数の問題がある場合はチェック順序の最初の1件だけを返す（利用日なし＋通貨コードなし→利用日なしが優先）", () => {
    const data = buildValidExpenseData({ transactionDate: null, currencyCode: null });
    const { error } = validateConcurExpenseData(data);

    expect(error.type).toBe("missing_transaction_date");
  });

  it("空オブジェクト・未定義を渡してもエラーにならずmissing_transaction_dateから順に判定する", () => {
    expect(validateConcurExpenseData({}).error.type).toBe("missing_transaction_date");
    expect(validateConcurExpenseData(undefined).error.type).toBe("missing_transaction_date");
  });
});
