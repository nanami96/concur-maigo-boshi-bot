import { describe, it, expect, beforeEach, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

const invokeMock = vi.fn();
const mockState = { isSupabaseConfigured: true };

vi.mock("../src/lib/supabaseClient.js", () => ({
  get isSupabaseConfigured() {
    return mockState.isSupabaseConfigured;
  },
  get supabase() {
    return mockState.isSupabaseConfigured ? { functions: { invoke: invokeMock } } : null;
  },
}));

const { analyzeReceiptImage, classifyOcrFunctionError } = await import(
  "../src/data/ocrReceiptRepository.js"
);

beforeEach(() => {
  mockState.isSupabaseConfigured = true;
  invokeMock.mockReset();
});

function makeFile() {
  return new File(["dummy"], "receipt.jpg", { type: "image/jpeg" });
}

describe("analyzeReceiptImage", () => {
  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;
    const result = await analyzeReceiptImage(makeFile());

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("成功時は正規化済みの結果をそのまま返す", async () => {
    const normalized = {
      transactionDate: "2026-07-14",
      merchantName: "株式会社あんしんネット21",
      totalAmount: 1000,
      currencyCode: "JPY",
      confidence: { transactionDate: 0.982, merchantName: 0.946, totalAmount: 0.976 },
    };
    invokeMock.mockResolvedValue({ data: normalized, error: null });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error).toBeNull();
    expect(result.result).toEqual(normalized);
    expect(invokeMock).toHaveBeenCalledWith("ocr-receipt", { body: expect.any(FormData) });
  });

  it("Edge Functionが未認証エラー(401)を返した場合、サーバーのメッセージ付きでunauthorizedとして分類する", async () => {
    const context = { json: async () => ({ error: { code: "unauthorized", message: "再度ログインしてください。" } }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("unauthorized");
    expect(result.error.message).toBe("再度ログインしてください。");
  });

  it("Edge Functionが解析失敗(422)を返した場合、analysis_failedとして分類する", async () => {
    const context = { json: async () => ({ error: { code: "analysis_failed", message: "読み取れませんでした。" } }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("analysis_failed");
  });

  it("Edge Functionがタイムアウト(504)を返した場合、timeoutとして分類する", async () => {
    const context = { json: async () => ({ error: { code: "timeout", message: "時間切れです。" } }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("timeout");
  });

  it("Edge Functionが不正なファイルとして拒否した場合、invalid_fileとして分類する", async () => {
    const context = { json: async () => ({ error: { code: "invalid_file", message: "画像を確認できませんでした。" } }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("invalid_file");
  });

  it("HTTPエラーの本文がJSONとして解析できない場合はunknownにフォールバックする", async () => {
    const context = { json: async () => { throw new Error("not json"); } };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("unknown");
  });

  it("ネットワーク到達不可（FunctionsFetchError）はnetworkとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError({}) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("network");
  });

  it("Supabaseリレー側のエラー（FunctionsRelayError）はunknownとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsRelayError({}) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("unknown");
  });

  it("invoke自体が例外を投げた場合はnetworkとして分類する", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));

    const result = await analyzeReceiptImage(makeFile());

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("network");
  });
});

describe("classifyOcrFunctionError", () => {
  it("エラーが無ければtype:nullを返す", async () => {
    const result = await classifyOcrFunctionError(null);
    expect(result).toEqual({ type: null, message: null });
  });
});
