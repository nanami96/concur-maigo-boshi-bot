import { describe, it, expect, afterEach, vi } from "vitest";
import {
  hasPendingAuthCallback,
  isAdminAuthCallback,
  resolveRootTree,
  cleanGeneralAuthCallbackUrl,
  exchangeAuthCallback,
  resolvePendingAuthSession,
} from "../src/admin/authCallback";

describe("hasPendingAuthCallback", () => {
  it("PKCE flowの?code=クエリがある場合はtrue", () => {
    expect(hasPendingAuthCallback({ search: "?code=abc123", hash: "" })).toBe(true);
  });

  it("implicit flowの#access_token=がhashにある場合もtrue（保険）", () => {
    expect(hasPendingAuthCallback({ search: "", hash: "#access_token=xyz&type=magiclink" })).toBe(
      true,
    );
  });

  it("#adminだけの通常の管理画面遷移はfalse", () => {
    expect(hasPendingAuthCallback({ search: "", hash: "#admin" })).toBe(false);
  });

  it("codeでもtokenでもない別のクエリ・ハッシュはfalse", () => {
    expect(hasPendingAuthCallback({ search: "?foo=bar", hash: "#admin" })).toBe(false);
  });

  it("search・hashが省略された場合もエラーにならずfalse", () => {
    expect(hasPendingAuthCallback()).toBe(false);
    expect(hasPendingAuthCallback({})).toBe(false);
  });
});

describe("isAdminAuthCallback", () => {
  it("authFlow=adminが付いている場合はtrue（管理画面Magic Linkログイン由来）", () => {
    expect(isAdminAuthCallback({ search: "?authFlow=admin&code=abc123" })).toBe(true);
  });

  it("authFlowが無い場合はfalse（一般ユーザーのsignUp確認メール由来）", () => {
    expect(isAdminAuthCallback({ search: "?code=abc123" })).toBe(false);
  });

  it("authFlowがadmin以外の値の場合はfalse", () => {
    expect(isAdminAuthCallback({ search: "?authFlow=user&code=abc123" })).toBe(false);
  });

  it("searchが省略された場合もエラーにならずfalse", () => {
    expect(isAdminAuthCallback()).toBe(false);
  });
});

describe("resolveRootTree", () => {
  it("#adminが既にある場合はadmin", () => {
    expect(resolveRootTree({ hash: "#admin", search: "" })).toBe("admin");
  });

  it("#adminが無く、authFlow=admin付きの認証コールバックがある場合はadmin（管理画面Magic Linkログイン）", () => {
    expect(resolveRootTree({ hash: "", search: "?authFlow=admin&code=abc123" })).toBe("admin");
  });

  it("#adminが無く、authFlowマーカーの無い認証コールバックの場合はgeneral（一般ユーザーのsignUp確認メール）", () => {
    expect(resolveRootTree({ hash: "", search: "?code=abc123" })).toBe("general");
  });

  it("認証コールバックが何も無い通常のトップページはgeneral", () => {
    expect(resolveRootTree({ hash: "", search: "" })).toBe("general");
  });

  it("引数省略時もエラーにならずgeneral", () => {
    expect(resolveRootTree()).toBe("general");
  });
});

describe("cleanGeneralAuthCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubWindowLocation(href) {
    const replaceStateMock = vi.fn();
    vi.stubGlobal("window", {
      location: { href },
      history: { replaceState: replaceStateMock },
    });
    return replaceStateMock;
  }

  it("?code=がある場合は取り除いてreplaceStateを呼ぶ", () => {
    const replaceStateMock = stubWindowLocation("http://localhost:5173/?code=abc123");
    cleanGeneralAuthCallbackUrl();

    expect(replaceStateMock).toHaveBeenCalledTimes(1);
    const newUrl = replaceStateMock.mock.calls[0][2];
    expect(newUrl).not.toContain("code=");
  });

  it("#access_token=がある場合はハッシュごと取り除く", () => {
    const replaceStateMock = stubWindowLocation(
      "http://localhost:5173/#access_token=xyz&type=magiclink",
    );
    cleanGeneralAuthCallbackUrl();

    expect(replaceStateMock).toHaveBeenCalledTimes(1);
    const newUrl = replaceStateMock.mock.calls[0][2];
    expect(newUrl).not.toContain("access_token");
  });

  it("認証コールバックの痕跡が無ければreplaceStateを呼ばない（無駄な履歴操作をしない）", () => {
    const replaceStateMock = stubWindowLocation("http://localhost:5173/");
    cleanGeneralAuthCallbackUrl();

    expect(replaceStateMock).not.toHaveBeenCalled();
  });
});

describe("exchangeAuthCallback", () => {
  it("?code=がある場合、exchangeCodeForSession(code)を呼ぶ（実Supabase不具合の再現テスト：この呼び出しが実際に行われることを保証する）", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const supabaseClient = { auth: { exchangeCodeForSession, setSession: vi.fn() } };

    const result = await exchangeAuthCallback(supabaseClient, { search: "?code=abc123", hash: "" });

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(supabaseClient.auth.setSession).not.toHaveBeenCalled();
    expect(result).toEqual({ error: null });
  });

  it("codeが無く#access_token=・#refresh_token=がある場合、setSession()を呼ぶ", async () => {
    const setSession = vi.fn().mockResolvedValue({ error: null });
    const supabaseClient = { auth: { exchangeCodeForSession: vi.fn(), setSession } };

    const result = await exchangeAuthCallback(supabaseClient, {
      search: "",
      hash: "#access_token=tok123&refresh_token=ref456&type=signup",
    });

    expect(setSession).toHaveBeenCalledWith({ access_token: "tok123", refresh_token: "ref456" });
    expect(supabaseClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(result).toEqual({ error: null });
  });

  it("codeとhash tokenの両方がある場合はcode（PKCE）を優先する", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const setSession = vi.fn().mockResolvedValue({ error: null });
    const supabaseClient = { auth: { exchangeCodeForSession, setSession } };

    await exchangeAuthCallback(supabaseClient, {
      search: "?code=abc123",
      hash: "#access_token=tok123&refresh_token=ref456",
    });

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(setSession).not.toHaveBeenCalled();
  });

  it("codeもhash tokenも無い場合は何も呼ばずerror:nullを返す", async () => {
    const exchangeCodeForSession = vi.fn();
    const setSession = vi.fn();
    const supabaseClient = { auth: { exchangeCodeForSession, setSession } };

    const result = await exchangeAuthCallback(supabaseClient, { search: "", hash: "" });

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    expect(result).toEqual({ error: null });
  });

  it("exchangeCodeForSessionが失敗した場合、そのエラーをそのまま返す（呼び出し元が失敗を検知できる）", async () => {
    const authError = { message: "invalid grant" };
    const supabaseClient = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: authError }),
        setSession: vi.fn(),
      },
    };

    const result = await exchangeAuthCallback(supabaseClient, { search: "?code=expired", hash: "" });

    expect(result).toEqual({ error: authError });
  });

  it("setSessionが失敗した場合、そのエラーをそのまま返す", async () => {
    const authError = { message: "invalid session" };
    const supabaseClient = {
      auth: {
        exchangeCodeForSession: vi.fn(),
        setSession: vi.fn().mockResolvedValue({ error: authError }),
      },
    };

    const result = await exchangeAuthCallback(supabaseClient, {
      search: "",
      hash: "#access_token=tok&refresh_token=ref",
    });

    expect(result).toEqual({ error: authError });
  });
});

describe("resolvePendingAuthSession", () => {
  function makeDeps({ hasCallback, exchangeError = null, session = null }) {
    const calls = [];
    const exchangeAuthCallbackMock = vi.fn().mockImplementation(async () => {
      calls.push("exchange");
      return { error: exchangeError };
    });
    const onExchangeSettled = vi.fn().mockImplementation(async () => {
      calls.push("settled");
    });
    const getSession = vi.fn().mockImplementation(async () => {
      calls.push("getSession");
      return { data: { session } };
    });

    return {
      calls,
      hasPendingAuthCallback: () => hasCallback,
      exchangeAuthCallback: exchangeAuthCallbackMock,
      onExchangeSettled,
      getSession,
    };
  }

  it("認証コールバックが無い場合、exchangeもonExchangeSettledも呼ばずgetSessionだけ呼ぶ（#admin直打ち・通常訪問に回帰が無いことの保証）", async () => {
    const deps = makeDeps({ hasCallback: false, session: null });

    const result = await resolvePendingAuthSession({ location: {}, ...deps });

    expect(deps.exchangeAuthCallback).not.toHaveBeenCalled();
    expect(deps.onExchangeSettled).not.toHaveBeenCalled();
    expect(deps.getSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ session: null });
  });

  it("認証コールバックがある場合、exchange→onExchangeSettled→getSessionの順序を必ず守る（exchange完了前にURL掃除・セッション確定をしないことの保証）", async () => {
    const deps = makeDeps({ hasCallback: true, exchangeError: null, session: { user: { id: "u1" } } });

    const result = await resolvePendingAuthSession({ location: { search: "?code=abc" }, ...deps });

    expect(deps.calls).toEqual(["exchange", "settled", "getSession"]);
    expect(deps.onExchangeSettled).toHaveBeenCalledWith({ success: true, error: null });
    expect(result).toEqual({ session: { user: { id: "u1" } } });
  });

  it("exchangeが失敗した場合もonExchangeSettledにsuccess:falseで通知した上で、getSessionは実行する", async () => {
    const authError = { message: "invalid grant" };
    const deps = makeDeps({ hasCallback: true, exchangeError: authError, session: null });

    const result = await resolvePendingAuthSession({ location: { search: "?code=bad" }, ...deps });

    expect(deps.onExchangeSettled).toHaveBeenCalledWith({ success: false, error: authError });
    expect(deps.getSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ session: null });
  });
});
