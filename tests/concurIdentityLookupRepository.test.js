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

const { lookupConcurUserIdentity, classifyLookupConcurUserFunctionError } = await import(
  "../src/data/concurIdentityLookupRepository.js"
);

const DUMMY_USER_NAME = "user@example.com";

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

describe("lookupConcurUserIdentity", () => {
  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("成功時（found:true）は結果をそのまま返す", async () => {
    const success = { found: true, hasUserId: true, multipleMatches: false };
    invokeMock.mockResolvedValue({ data: { result: success }, error: null });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error).toBeNull();
    expect(result.result).toEqual(success);
  });

  it("userNameをbodyに含めてPOSTで呼び出す", async () => {
    invokeMock.mockResolvedValue({ data: { result: { found: false, status: "disabled" } }, error: null });

    await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(invokeMock).toHaveBeenCalledWith("lookup-concur-user", {
      body: { userName: DUMMY_USER_NAME },
      timeout: expect.any(Number),
    });
  });

  it("安全ゲート無効時（found:false, status:disabled）もエラーではなく成功として返す", async () => {
    const disabled = { found: false, status: "disabled" };
    invokeMock.mockResolvedValue({ data: { result: disabled }, error: null });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error).toBeNull();
    expect(result.result).toEqual(disabled);
  });

  it("Edge Functionが固定エラーコード（0件・複数件等）を返した場合、そのコードだけをtypeとして返す（messageは保持しない）", async () => {
    const context = {
      json: async () => ({ error: { code: "concur_user_not_found", message: "指定された利用者情報が見つかりませんでした。" } }),
    };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.result).toBeNull();
    expect(result.error).toEqual({ type: "concur_user_not_found" });
    expect(result.error.message).toBeUndefined();
  });

  it("複数件（concur_user_ambiguous）もそのままtypeへ渡す", async () => {
    const context = { json: async () => ({ error: { code: "concur_user_ambiguous", message: "x" } }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error.type).toBe("concur_user_ambiguous");
  });

  it("Edge Functionが未認証エラー(401)を返した場合、unauthorizedとして分類する", async () => {
    const context = { json: async () => ({ error: { code: "unauthorized", message: "再度ログインしてください。" } }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error.type).toBe("unauthorized");
  });

  it("HTTPエラーの本文がJSONとして解析できない場合はunknownにフォールバックする", async () => {
    const context = { json: async () => { throw new Error("not json"); } };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error.type).toBe("unknown");
  });

  it("本文がEdge Function独自の形式でなくても、HTTPステータスが401ならunauthorizedとして分類する", async () => {
    const context = { status: 401, json: async () => ({ message: "Missing authorization header" }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error.type).toBe("unauthorized");
  });

  it("ネットワーク到達不可（FunctionsFetchError）はnetworkとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError({}) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error.type).toBe("network");
  });

  it("クライアント側タイムアウトによる中断（AbortError）はtimeoutとして分類する", async () => {
    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError(abortError) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error.type).toBe("timeout");
  });

  it("Supabaseリレー側のエラー（FunctionsRelayError）はunknownとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsRelayError({}) });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.error.type).toBe("unknown");
  });

  it("invoke自体が例外を投げた場合はnetworkとして分類する", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("network");
  });

  it("セッションが無く、refreshSessionでも復元できない場合はEdge Functionを呼ばずunauthorizedを返す", async () => {
    mockNoSession();

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.result).toBeNull();
    expect(result.error.type).toBe("unauthorized");
  });

  it("getSession/refreshSession自体が例外を投げた場合もEdge Functionを呼ばずunauthorizedを返す（fail-closed）", async () => {
    getSessionMock.mockRejectedValue(new Error("network down"));

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.error.type).toBe("unauthorized");
  });

  it("有効なセッションがある場合はrefreshSessionを呼ばずにEdge Functionを呼ぶ", async () => {
    invokeMock.mockResolvedValue({ data: { result: { found: false, status: "disabled" } }, error: null });

    await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("成功時の戻り値は真偽値フィールドのみで、Token・利用者プロフィールに相当する文字列値を含まない", async () => {
    invokeMock.mockResolvedValue({
      data: { result: { found: true, hasUserId: true, multipleMatches: false } },
      error: null,
    });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    Object.values(result.result).forEach((value) => {
      expect(typeof value).toBe("boolean");
    });
  });

  it("入力したuserNameの値が戻り値へ反射されない（成功時）", async () => {
    invokeMock.mockResolvedValue({
      data: { result: { found: true, hasUserId: true, multipleMatches: false } },
      error: null,
    });

    const result = await lookupConcurUserIdentity(DUMMY_USER_NAME);

    expect(JSON.stringify(result)).not.toContain(DUMMY_USER_NAME);
  });
});

describe("classifyLookupConcurUserFunctionError", () => {
  it("エラーが無ければtype:nullを返す", async () => {
    const result = await classifyLookupConcurUserFunctionError(null);
    expect(result).toEqual({ type: null });
  });
});
