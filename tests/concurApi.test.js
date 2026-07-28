import { describe, it, expect, beforeEach, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

// tests/ocrReceiptRepository.test.jsと同じモック方式（supabase/functions.invoke・
// auth.getSession/refreshSessionをモックし、実際のHTTP通信・Supabaseプロジェクトへは
// 一切接続しない）。
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

const { getAccessToken, createQuickExpense, uploadReceipt, classifyQuickExpenseFunctionError } =
  await import("../src/data/concurApi.js");

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

function buildExpenseData(overrides = {}) {
  return {
    companyId: "company-a",
    policyId: "policy-x",
    botExpenseTypeId: "taxi",
    concurExpenseTypeId: "CONCUR_TAXI_A_X",
    transactionDate: "2026-07-28",
    amount: 1000,
    currencyCode: "JPY",
    receiptRequired: false,
    ...overrides,
  };
}

describe("createQuickExpense", () => {
  it("Supabase未設定なら呼び出さずエラーを返す", async () => {
    mockState.isSupabaseConfigured = false;

    const result = await createQuickExpense(buildExpenseData());

    expect(result.result).toBeNull();
    expect(result.error).not.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("セッションが無く、refreshSessionでも復元できない場合はEdge Functionを呼ばずunauthorizedを返す", async () => {
    mockNoSession();

    const result = await createQuickExpense(buildExpenseData());

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.result).toBeNull();
    expect(result.error.type).toBe("unauthorized");
  });

  it("getSessionではセッションが無いが、refreshSessionで復元できた場合はEdge Functionを呼ぶ", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    refreshSessionMock.mockResolvedValue({ data: { session: { access_token: "refreshed-token" } } });
    invokeMock.mockResolvedValue({
      data: { result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null },
      error: null,
    });

    const result = await createQuickExpense(buildExpenseData());

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
  });

  it("有効なセッションがある場合はrefreshSessionを呼ばずにEdge Functionを呼ぶ", async () => {
    invokeMock.mockResolvedValue({
      data: { result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null },
      error: null,
    });

    await createQuickExpense(buildExpenseData());

    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("getSession/refreshSession自体が例外を投げた場合もEdge Functionを呼ばずunauthorizedを返す（fail-closed）", async () => {
    getSessionMock.mockRejectedValue(new Error("network down"));

    const result = await createQuickExpense(buildExpenseData());

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.error.type).toBe("unauthorized");
  });

  it("正しいEdge Function名・タイムアウト付きでinvokeを呼ぶ", async () => {
    invokeMock.mockResolvedValue({
      data: { result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null },
      error: null,
    });

    const expenseData = buildExpenseData();
    await createQuickExpense(expenseData);

    expect(invokeMock).toHaveBeenCalledWith("create-concur-quick-expense", {
      body: expenseData,
      timeout: expect.any(Number),
    });
  });

  it("成功時はEdge Functionのresultをそのまま返す", async () => {
    invokeMock.mockResolvedValue({
      data: { result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null },
      error: null,
    });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ quickExpenseId: "stub_quick_expense_id", status: "stubbed" });
  });

  it("Edge Functionがvalidation_error(400)を返した場合、コードとdetailsを引き継いで分類する", async () => {
    const context = {
      status: 400,
      json: async () => ({
        result: null,
        error: {
          code: "validation_error",
          message: "入力内容を確認してください。",
          details: [{ field: "amount", reason: "invalid_range" }],
        },
      }),
    };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await createQuickExpense(buildExpenseData({ amount: 0 }));

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("validation_error");
    expect(result.error.message).toBe("入力内容を確認してください。");
    expect(result.error.details).toEqual([{ field: "amount", reason: "invalid_range" }]);
  });

  it("Edge Functionがmethod_not_allowed(405)を返した場合、そのコードで分類する", async () => {
    const context = {
      status: 405,
      json: async () => ({ result: null, error: { code: "method_not_allowed", message: "許可されていないメソッドです。", details: [] } }),
    };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error.type).toBe("method_not_allowed");
  });

  it("Edge Functionが内部エラー(500・internal_error)を返した場合、内容を漏らさずinternal_errorとして分類する", async () => {
    const context = {
      status: 500,
      json: async () => ({ result: null, error: { code: "internal_error", message: "処理中にエラーが発生しました。", details: [] } }),
    };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error.type).toBe("internal_error");
    expect(JSON.stringify(result)).not.toMatch(/token|secret/i);
  });

  it("本文がJSONとして解析できない場合はunknownにフォールバックする", async () => {
    const context = { json: async () => { throw new Error("not json"); } };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error.type).toBe("unknown");
  });

  it("本文がEdge Function独自の形式でなくても、HTTPステータスが401ならunauthorizedとして分類する", async () => {
    const context = { status: 401, json: async () => ({ message: "Missing authorization header" }) };
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error.type).toBe("unauthorized");
  });

  it("ネットワーク到達不可（FunctionsFetchError）はnetworkとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError({}) });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error.type).toBe("network");
  });

  it("クライアント側タイムアウトによる中断（AbortError）はtimeoutとして分類する", async () => {
    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsFetchError(abortError) });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error.type).toBe("timeout");
  });

  it("Supabaseリレー側のエラー（FunctionsRelayError）はunknownとして分類する", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FunctionsRelayError({}) });

    const result = await createQuickExpense(buildExpenseData());

    expect(result.error.type).toBe("unknown");
  });

  it("invoke自体が例外を投げた場合はnetworkとして分類する", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));

    const result = await createQuickExpense(buildExpenseData());

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("network");
  });

  it("実際の外部HTTP通信(fetch)を一切発生させない（invoke自体をモックしているため）", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    invokeMock.mockResolvedValue({
      data: { result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null },
      error: null,
    });

    await createQuickExpense(buildExpenseData());

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("Client ID・Client Secret・アクセストークンをコードのどこにも参照・送信しない（呼び出し引数の確認）", async () => {
    invokeMock.mockResolvedValue({
      data: { result: { quickExpenseId: "stub_quick_expense_id", status: "stubbed" }, error: null },
      error: null,
    });

    await createQuickExpense(buildExpenseData());

    const [, options] = invokeMock.mock.calls[0];
    const sentBody = JSON.stringify(options.body);
    expect(sentBody).not.toMatch(/client_?secret/i);
    expect(sentBody).not.toMatch(/access_?token/i);
    expect(sentBody).not.toMatch(/refresh_?token/i);
  });
});

describe("classifyQuickExpenseFunctionError", () => {
  it("エラーが無ければtype:nullを返す", async () => {
    const result = await classifyQuickExpenseFunctionError(null);
    expect(result).toEqual({ type: null, message: null, details: [] });
  });
});

describe("getAccessToken（今回未実装のまま）", () => {
  it("Supabase設定の有無に関わらずnot_implementedを返し、Edge Functionを呼ばない", async () => {
    const result = await getAccessToken();

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("not_implemented");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("uploadReceipt（今回未実装のまま）", () => {
  it("Supabase設定の有無に関わらずnot_implementedを返し、Edge Functionを呼ばない", async () => {
    const result = await uploadReceipt("stub_quick_expense_id", new File(["dummy"], "receipt.png"));

    expect(result.result).toBeNull();
    expect(result.error.type).toBe("not_implemented");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
