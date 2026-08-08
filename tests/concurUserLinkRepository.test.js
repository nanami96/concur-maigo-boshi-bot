import { describe, it, expect, beforeEach, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

const invokeMock = vi.fn();
const rpcMock = vi.fn();
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
          rpc: rpcMock,
          auth: { getSession: getSessionMock, refreshSession: refreshSessionMock },
        }
      : null;
  },
}));

const { getConcurUserLinkStatus, linkConcurUser, unlinkConcurUser, classifyLinkConcurUserFunctionError } =
  await import("../src/data/concurUserLinkRepository.js");

const DUMMY_COMPANY_CODE = "connect-company";
const DUMMY_CONCUR_LOGIN_ID = "user@example.com";

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
  rpcMock.mockReset();
  getSessionMock.mockReset();
  refreshSessionMock.mockReset();
  mockValidSession();
});

describe("getConcurUserLinkStatus", () => {
  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;

    const result = await getConcurUserLinkStatus(DUMMY_COMPANY_CODE);

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("get_my_concur_link_status RPCをcompanyCodeで呼び出す", async () => {
    rpcMock.mockResolvedValue({ data: [{ has_link: true, verified_at: "2026-08-01T00:00:00Z" }], error: null });

    await getConcurUserLinkStatus(DUMMY_COMPANY_CODE);

    expect(rpcMock).toHaveBeenCalledWith("get_my_concur_link_status", { p_company_code: DUMMY_COMPANY_CODE });
  });

  it("has_link:trueの場合はhasLink:true・verifiedAtを返す", async () => {
    rpcMock.mockResolvedValue({ data: [{ has_link: true, verified_at: "2026-08-01T00:00:00Z" }], error: null });

    const result = await getConcurUserLinkStatus(DUMMY_COMPANY_CODE);

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ hasLink: true, verifiedAt: "2026-08-01T00:00:00Z" });
  });

  it("0行（未紐付け・未所属）の場合はhasLink:falseを返す（エラーではない）", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await getConcurUserLinkStatus(DUMMY_COMPANY_CODE);

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ hasLink: false, verifiedAt: null });
  });

  it("RPCがエラーを返した場合もhasLink:falseへ倒す設計ではなく、resultをnullにしerrorを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await getConcurUserLinkStatus(DUMMY_COMPANY_CODE);

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("戻り値にConcurログインIDの生値を一切含まない", async () => {
    rpcMock.mockResolvedValue({ data: [{ has_link: true, verified_at: "2026-08-01T00:00:00Z" }], error: null });

    const result = await getConcurUserLinkStatus(DUMMY_COMPANY_CODE);

    expect(Object.keys(result.result).sort()).toEqual(["hasLink", "verifiedAt"]);
  });
});

describe("linkConcurUser", () => {
  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("companyCode・concurLoginIdをbodyに含めてlink-concur-userを呼び出す", async () => {
    invokeMock.mockResolvedValue({ data: { result: { linked: true } }, error: null });

    await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(invokeMock).toHaveBeenCalledWith("link-concur-user", {
      body: { companyCode: DUMMY_COMPANY_CODE, concurLoginId: DUMMY_CONCUR_LOGIN_ID },
      timeout: expect.any(Number),
    });
  });

  it("成功時（linked:true）は結果をそのまま返す", async () => {
    invokeMock.mockResolvedValue({ data: { result: { linked: true } }, error: null });

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ linked: true });
  });

  it("安全ゲート無効時（linked:false, status:disabled）もエラーではなく成功として返す", async () => {
    invokeMock.mockResolvedValue({ data: { result: { linked: false, status: "disabled" } }, error: null });

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ linked: false, status: "disabled" });
  });

  it("Edge Functionが固定エラーコードを返した場合、そのコードだけをtypeとして返す", async () => {
    const context = {
      json: async () => ({ error: { code: "concur_user_not_found", message: "指定された利用者情報が見つかりませんでした。" } }),
    };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(result.result).toBeNull();
    expect(result.error).toEqual({ type: "concur_user_not_found" });
  });

  it("401はunauthorizedとして分類する", async () => {
    const context = { status: 401, json: async () => ({ message: "Missing authorization header" }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(result.error.type).toBe("unauthorized");
  });

  it("ネットワーク到達不可（FunctionsFetchError）はnetworkとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError({}) });

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(result.error.type).toBe("network");
  });

  it("Supabaseリレー側のエラー（FunctionsRelayError）はunknownとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsRelayError({}) });

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(result.error.type).toBe("unknown");
  });

  it("セッションが無く、refreshSessionでも復元できない場合はEdge Functionを呼ばずunauthorizedを返す", async () => {
    mockNoSession();

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.error.type).toBe("unauthorized");
  });

  it("入力したconcurLoginIdの値が戻り値へ反射されない（成功時）", async () => {
    invokeMock.mockResolvedValue({ data: { result: { linked: true } }, error: null });

    const result = await linkConcurUser(DUMMY_COMPANY_CODE, DUMMY_CONCUR_LOGIN_ID);

    expect(JSON.stringify(result)).not.toContain(DUMMY_CONCUR_LOGIN_ID);
  });
});

describe("classifyLinkConcurUserFunctionError", () => {
  it("エラーが無ければtype:nullを返す", async () => {
    const result = await classifyLinkConcurUserFunctionError(null);
    expect(result).toEqual({ type: null });
  });
});

describe("unlinkConcurUser", () => {
  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;

    const result = await unlinkConcurUser(DUMMY_COMPANY_CODE);

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("unlink_my_concur_user RPCをcompanyCodeで呼び出す", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    await unlinkConcurUser(DUMMY_COMPANY_CODE);

    expect(rpcMock).toHaveBeenCalledWith("unlink_my_concur_user", { p_company_code: DUMMY_COMPANY_CODE });
  });

  it("trueが返れば unlinked:true を返す", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    const result = await unlinkConcurUser(DUMMY_COMPANY_CODE);

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ unlinked: true });
  });

  it("falseが返れば unlinked:false を返す（エラーではない）", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    const result = await unlinkConcurUser(DUMMY_COMPANY_CODE);

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ unlinked: false });
  });

  it("RPCがエラーを返した場合はerrorを返す", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await unlinkConcurUser(DUMMY_COMPANY_CODE);

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
  });
});
