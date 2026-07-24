import { describe, it, expect } from "vitest";
import { normalizeReceiptAnalyzeResult } from "../supabase/functions/ocr-receipt/normalizeReceiptResult.js";

// Azure実APIは呼ばない。実際に検証済みの日本語タクシー領収書のレスポンス形
// （MerchantName/TransactionDate/Total/ReceiptType等）を模したフィクスチャで、
// 正規化ロジックだけをテストする。
function buildAnalyzeResult(fieldOverrides = {}) {
  return {
    documents: [
      {
        fields: {
          MerchantName: { type: "string", valueString: "株式会社あんしんネット21", confidence: 0.946 },
          TransactionDate: { type: "date", valueDate: "2026-07-14", confidence: 0.982 },
          Total: {
            type: "currency",
            valueCurrency: { amount: 1000, currencyCode: "JPY" },
            confidence: 0.976,
          },
          // ReceiptTypeが実際のレスポンスに含まれていても、正規化結果には
          // 一切現れないことを他のテストで確認する（経費タイプ判定への不使用）。
          ReceiptType: { type: "string", valueString: "Transportation.Taxi", confidence: 0.6 },
          ...fieldOverrides,
        },
      },
    ],
  };
}

describe("normalizeReceiptAnalyzeResult", () => {
  it("実際に検証済みのレスポンス形から、必要なフィールドだけを正規化する", () => {
    const result = normalizeReceiptAnalyzeResult(buildAnalyzeResult());

    expect(result).toEqual({
      transactionDate: "2026-07-14",
      merchantName: "株式会社あんしんネット21",
      totalAmount: 1000,
      currencyCode: "JPY",
      confidence: {
        transactionDate: 0.982,
        merchantName: 0.946,
        totalAmount: 0.976,
      },
    });
  });

  it("ReceiptTypeを一切返さない（経費タイプ判定に使用しないことの確認）", () => {
    const result = normalizeReceiptAnalyzeResult(buildAnalyzeResult());
    expect(result).not.toHaveProperty("receiptType");
    expect(JSON.stringify(result)).not.toContain("Taxi");
    expect(JSON.stringify(result)).not.toContain("ReceiptType");
  });

  it("MerchantNameが欠落していてもnullで返し、他のフィールドは正常に返す", () => {
    const analyzeResult = buildAnalyzeResult({ MerchantName: undefined });
    const result = normalizeReceiptAnalyzeResult(analyzeResult);

    expect(result.merchantName).toBeNull();
    expect(result.transactionDate).toBe("2026-07-14");
    expect(result.totalAmount).toBe(1000);
  });

  it("TransactionDateが欠落していてもnullで返す", () => {
    const analyzeResult = buildAnalyzeResult({ TransactionDate: undefined });
    const result = normalizeReceiptAnalyzeResult(analyzeResult);

    expect(result.transactionDate).toBeNull();
    expect(result.merchantName).toBe("株式会社あんしんネット21");
  });

  it("Total（valueCurrency）が欠落していてもnullで返す", () => {
    const analyzeResult = buildAnalyzeResult({ Total: undefined });
    const result = normalizeReceiptAnalyzeResult(analyzeResult);

    expect(result.totalAmount).toBeNull();
    expect(result.currencyCode).toBeNull();
  });

  it("TotalがvalueCurrencyではなくvalueNumberで返る場合はそちらを使う（currencyCodeはnull）", () => {
    const analyzeResult = buildAnalyzeResult({
      Total: { type: "number", valueNumber: 2500, confidence: 0.9 },
    });
    const result = normalizeReceiptAnalyzeResult(analyzeResult);

    expect(result.totalAmount).toBe(2500);
    expect(result.currencyCode).toBeNull();
  });

  it("MerchantNameがvalueStringを持たずcontentのみの場合はcontentへフォールバックする", () => {
    const analyzeResult = buildAnalyzeResult({
      MerchantName: { type: "string", content: "テスト商店", confidence: 0.7 },
    });
    const result = normalizeReceiptAnalyzeResult(analyzeResult);

    expect(result.merchantName).toBe("テスト商店");
  });

  it("confidenceが無いフィールドはconfidence.xxxがnullになる", () => {
    const analyzeResult = buildAnalyzeResult({
      MerchantName: { type: "string", valueString: "テスト商店" },
    });
    const result = normalizeReceiptAnalyzeResult(analyzeResult);

    expect(result.confidence.merchantName).toBeNull();
    expect(result.confidence.transactionDate).toBe(0.982);
  });

  it("documentsが空配列でもエラーにならず全項目nullを返す", () => {
    const result = normalizeReceiptAnalyzeResult({ documents: [] });

    expect(result).toEqual({
      transactionDate: null,
      merchantName: null,
      totalAmount: null,
      currencyCode: null,
      confidence: { transactionDate: null, merchantName: null, totalAmount: null },
    });
  });

  it("analyzeResult自体がundefinedでもエラーにならず全項目nullを返す", () => {
    const result = normalizeReceiptAnalyzeResult(undefined);

    expect(result.transactionDate).toBeNull();
    expect(result.merchantName).toBeNull();
    expect(result.totalAmount).toBeNull();
    expect(result.currencyCode).toBeNull();
  });
});
