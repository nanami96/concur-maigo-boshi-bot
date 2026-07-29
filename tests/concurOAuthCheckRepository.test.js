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

const { checkConcurOAuthConnection, classifyConcurOAuthCheckFunctionError } = await import(
  "../src/data/concurOAuthCheckRepository.js"
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
  mockValidSession();
});

describe("checkConcurOAuthConnection", () => {
  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;

    const result = await checkConcurOAuthConnection();

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("成功時（connected:true）は結果をそのまま返す", async () => {
    const success = {
      connected: true,
      hasGeolocation: true,
      expiresInPresent: false,
      refreshTokenRotated: true,
    };
    invokeMock.mockResolvedValue({ data: { result: success, error: null }, error: null });

    const result = await checkConcurOAuthConnection();

    expect(result.error).toBeNull();
    expect(result.result).toEqual(success);
  });

  it("bodyを送らずPOSTで呼び出す（リクエスト本文が無いことの回帰確認）", async () => {
    invokeMock.mockResolvedValue({ data: { result: { connected: false, status: "disabled" } }, error: null });

    await checkConcurOAuthConnection();

    expect(invokeMock).toHaveBeenCalledWith("check-concur-oauth", {
      timeout: expect.any(Number),
    });
    const [, options] = invokeMock.mock.calls[0];
    expect(options.body).toBeUndefined();
  });

  it("安全ゲート無効時（connected:false, status:disabled）もエラーではなく成功として返す", async () => {
    const disabled = { connected: false, status: "disabled" };
    invokeMock.mockResolvedValue({ data: { result: disabled }, error: null });

    const result = await checkConcurOAuthConnection();

    expect(result.error).toBeNull();
    expect(result.result).toEqual(disabled);
  });

  it("Edge Functionが固定エラーコードを返した場合、そのコードだけをtypeとして返す（messageは保持しない）", async () => {
    const context = {
      json: async () => ({ error: { code: "concur_oauth_not_connected", message: "現在Concurとの接続情報を利用できません。" } }),
    };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await checkConcurOAuthConnection();

    expect(result.result).toBeNull();
    expect(result.error).toEqual({ type: "concur_oauth_not_connected" });
    expect(result.error.message).toBeUndefined();
  });

  it("Edge Functionが未認証エラー(401)を返した場合、unauthorizedとして分類する", async () => {
    const context = { json: async () => ({ error: { code: "unauthorized", message: "再度ログインしてください。" } }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await checkConcurOAuthConnection();

    expect(result.error.type).toBe("unauthorized");
  });

  it("HTTPエラーの本文がJSONとして解析できない場合はunknownにフォールバックする", async () => {
    const context = { json: async () => { throw new Error("not json"); } };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await checkConcurOAuthConnection();

    expect(result.error.type).toBe("unknown");
  });

  it("本文がEdge Function独自の形式でなくても、HTTPステータスが401ならunauthorizedとして分類する", async () => {
    const context = { status: 401, json: async () => ({ message: "Missing authorization header" }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await checkConcurOAuthConnection();

    expect(result.error.type).toBe("unauthorized");
  });

  it("ネットワーク到達不可（FunctionsFetchError）はnetworkとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError({}) });

    const result = await checkConcurOAuthConnection();

    expect(result.error.type).toBe("network");
  });

  it("クライアント側タイムアウトによる中断（AbortError）はtimeoutとして分類する", async () => {
    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError(abortError) });

    const result = await checkConcurOAuthConnection();

    expect(result.error.type).toBe("timeout");
  });

  it("Supabaseリレー側のエラー（FunctionsRelayError）はunknownとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsRelayError({}) });

    const result = await checkConcurOAuthConnection();

    expect(result.error.type).toBe("unknown");
  });

  it("invoke自体が例外を投げた場合はnetworkとして分類する", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));

    const result = await checkConcurOAuthConnection();

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("network");
  });

  it("セッションが無く、refreshSessionでも復元できない場合はEdge Functionを呼ばずunauthorizedを返す", async () => {
    mockNoSession();

    const result = await checkConcurOAuthConnection();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.result).toBeNull();
    expect(result.error.type).toBe("unauthorized");
  });

  it("getSession/refreshSession自体が例外を投げた場合もEdge Functionを呼ばずunauthorizedを返す（fail-closed）", async () => {
    getSessionMock.mockRejectedValue(new Error("network down"));

    const result = await checkConcurOAuthConnection();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.error.type).toBe("unauthorized");
  });

  it("有効なセッションがある場合はrefreshSessionを呼ばずにEdge Functionを呼ぶ", async () => {
    invokeMock.mockResolvedValue({ data: { result: { connected: false, status: "disabled" } }, error: null });

    await checkConcurOAuthConnection();

    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("成功時の戻り値は4つの真偽値フィールドのみで、Token/Secret実値に相当する文字列値を含まない（フィールド名にrefreshTokenRotatedを含むのは仕様どおり）", async () => {
    invokeMock.mockResolvedValue({
      data: { result: { connected: true, hasGeolocation: true, expiresInPresent: true, refreshTokenRotated: true } },
      error: null,
    });

    const result = await checkConcurOAuthConnection();

    expect(result.result).toEqual({
      connected: true,
      hasGeolocation: true,
      expiresInPresent: true,
      refreshTokenRotated: true,
    });
    // 値がすべてbooleanであること＝Token本体等の文字列値が紛れ込んでいないこと。
    Object.values(result.result).forEach((value) => {
      expect(typeof value).toBe("boolean");
    });
  });
});

describe("classifyConcurOAuthCheckFunctionError", () => {
  it("エラーが無ければtype:nullを返す", async () => {
    const result = await classifyConcurOAuthCheckFunctionError(null);
    expect(result).toEqual({ type: null });
  });
});
