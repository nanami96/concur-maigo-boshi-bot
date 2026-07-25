import { describe, it, expect, beforeEach, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

const invokeMock = vi.fn();
const getSessionMock = vi.fn();
const refreshSessionMock = vi.fn();
const mockState = { isSupabaseConfigured: true };

vi.mock("../src/lib/supabaseClient.js", () => ({
  get isSupabaseConfigured() {
    return mockState.isSupabaseConfigured;
  },
  get supabase() {
    return mockState.isSupabaseConfigured
      ? {
          functions: { invoke: invokeMock },
          auth: { getSession: getSessionMock, refreshSession: refreshSessionMock },
        }
      : null;
  },
}));

const { analyzeReceiptImage, classifyOcrFunctionError } = await import(
  "../src/data/ocrReceiptRepository.js"
);

function mockValidSession() {
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "valid-token" } } });
  refreshSessionMock.mockResolvedValue({ data: { session: null } });
}

function mockNoSession() {
  getSessionMock.mockResolvedValue({ data: { session: null } });
  refreshSessionMock.mockResolvedValue({ data: { session: null } });
}

beforeEach(() => {
  mockState.isSupabaseConfigured = true;
  invokeMock.mockReset();
  getSessionMock.mockReset();
  refreshSessionMock.mockReset();
  // 既存の分類テスト（Edge Functionのレスポンス分岐）はセッションの有無を
  // 検証対象にしていないため、既定では有効なセッションがある状態にする。
  // セッション自体を検証するテストだけmockNoSession()で個別に上書きする。
  mockValidSession();
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
    expect(invokeMock).toHaveBeenCalledWith("ocr-receipt", {
      body: expect.any(FormData),
      timeout: expect.any(Number),
    });
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

  it("クライアント側タイムアウトによる中断（AbortError）はtimeoutとして分類する", async () => {
    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError(abortError) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("timeout");
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

  it("本文がEdge Function独自の形式でなくても、HTTPステータスが401ならunauthorizedとして分類する", async () => {
    // Supabaseプラットフォーム自体（verify_jwt）がこの関数のコードより前で
    // リクエストを拒否した場合等、本文が{error:{code,message}}形式でない401を
    // 想定したケース。
    const context = { status: 401, json: async () => ({ message: "Missing authorization header" }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("unauthorized");
  });

  it("本文がJSONとして解析できなくても、HTTPステータスが401ならunauthorizedとして分類する", async () => {
    const context = { status: 401, json: async () => { throw new Error("not json"); } };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await analyzeReceiptImage(makeFile());

    expect(result.error.type).toBe("unauthorized");
  });

  it("セッションが無く、refreshSessionでも復元できない場合はEdge Functionを呼ばずunauthorizedを返す", async () => {
    mockNoSession();

    const result = await analyzeReceiptImage(makeFile());

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.result).toBeNull();
    expect(result.error.type).toBe("unauthorized");
  });

  it("getSessionではセッションが無いが、refreshSessionで復元できた場合はEdge Functionを呼ぶ", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    refreshSessionMock.mockResolvedValue({ data: { session: { access_token: "refreshed-token" } } });
    invokeMock.mockResolvedValue({ data: { transactionDate: null, merchantName: null, totalAmount: null, currencyCode: null, confidence: {} }, error: null });

    const result = await analyzeReceiptImage(makeFile());

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
  });

  it("getSession/refreshSession自体が例外を投げた場合もEdge Functionを呼ばずunauthorizedを返す（fail-closed）", async () => {
    getSessionMock.mockRejectedValue(new Error("network down"));

    const result = await analyzeReceiptImage(makeFile());

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.error.type).toBe("unauthorized");
  });

  it("有効なセッションがある場合はrefreshSessionを呼ばずにEdge Functionを呼ぶ", async () => {
    invokeMock.mockResolvedValue({ data: { transactionDate: null, merchantName: null, totalAmount: null, currencyCode: null, confidence: {} }, error: null });

    await analyzeReceiptImage(makeFile());

    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("classifyOcrFunctionError", () => {
  it("エラーが無ければtype:nullを返す", async () => {
    const result = await classifyOcrFunctionError(null);
    expect(result).toEqual({ type: null, message: null });
  });
});
