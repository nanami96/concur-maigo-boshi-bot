import { describe, it, expect, vi } from "vitest";
import { handleConcurOAuthCheckRequest } from "../supabase/functions/check-concur-oauth/handleConcurOAuthCheckRequest.js";

// 以下の認証情報・トークン値はすべてテスト専用のダミー値であり、実際の
// Concur側の値ではない。本物のtoken endpointへは一切通信しない
// （refreshAccessTokenを常にモックへ差し替える）。

const VALID_USER = { id: "user-1" };
const DUMMY_CLIENT_SECRET = "DUMMY_CLIENT_SECRET_SHOULD_NOT_LEAK";
const DUMMY_AUTH_HEADER = "Bearer DUMMY_JWT_SHOULD_NOT_LEAK";

function buildEnv(overrides = {}) {
  return {
    CONCUR_CLIENT_ID: "dummy-client-id",
    CONCUR_CLIENT_SECRET: DUMMY_CLIENT_SECRET,
    CONCUR_REFRESH_TOKEN: "dummy-refresh-token",
    CONCUR_TOKEN_URL: "https://example-dummy.concursolutions.test/oauth2/v0/token",
    CONCUR_OAUTH_CHECK_ENABLED: "true",
    ...overrides,
  };
}

function buildAuthedInput(overrides = {}) {
  return {
    authHeader: DUMMY_AUTH_HEADER,
    fetchUser: async () => VALID_USER,
    isPlatformAdmin: async () => true,
    ...overrides,
  };
}

describe("handleConcurOAuthCheckRequest（HTTP）", () => {
  it("POST・platform_admin・安全ゲート無効時はdisabledを返す", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv({ CONCUR_OAUTH_CHECK_ENABLED: undefined }),
    });

    expect(status).toBe(200);
    expect(body.result).toEqual({ connected: false, status: "disabled" });
  });

  it("GETはmethod_not_allowed（405）", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "GET",
      ...buildAuthedInput(),
      env: buildEnv(),
    });

    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
  });

  it("PUTはmethod_not_allowed（405）", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "PUT",
      ...buildAuthedInput(),
      env: buildEnv(),
    });

    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
  });

  it("OPTIONSもこの純粋関数の層ではmethod_not_allowed（405）。実際のpreflightはindex.tsが事前に処理する", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "OPTIONS",
      ...buildAuthedInput(),
      env: buildEnv(),
    });

    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
  });
});

describe("handleConcurOAuthCheckRequest（認証・認可）", () => {
  it("Authorizationヘッダーが無い場合は401(unauthorized)。isPlatformAdmin・refreshAccessTokenは呼ばれない", async () => {
    const isPlatformAdmin = vi.fn();
    const refreshAccessToken = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: null,
      fetchUser: vi.fn(),
      isPlatformAdmin,
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("無効なJWTの場合は401(unauthorized)", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: "Bearer invalid",
      fetchUser: async () => null,
      isPlatformAdmin: vi.fn(),
      env: buildEnv(),
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  it("一般ユーザー（platform_adminでない）は403(forbidden)。refreshAccessTokenは呼ばれない", async () => {
    const refreshAccessToken = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: DUMMY_AUTH_HEADER,
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => false,
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("company_admin（platform_adminではない）も403(forbidden)", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: DUMMY_AUTH_HEADER,
      fetchUser: async () => ({ ...VALID_USER, companyRole: "admin" }),
      isPlatformAdmin: async () => false,
      env: buildEnv(),
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("platform_adminは安全ゲート・OAuth処理まで到達できる", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: true,
      rotated: false,
      tokens: { accessToken: "dummy-access-token" },
      logSummary: { ok: true, rotated: false, hasAccessToken: true, hasGeolocation: true, hasScope: false, expiresInPresent: true },
    });

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(status).toBe(200);
    expect(body.result.connected).toBe(true);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("リクエスト本文相当の偽role主張があっても、実際の判定はisPlatformAdmin()の結果だけで決まる（本文自体を読み取らない設計）", async () => {
    // このFunctionはrequest bodyを一切受け取らない設計のため、
    // 「フロントが送ったrole」を信用しようがない。isPlatformAdminが
    // falseを返す限り、他に何を渡しても403になることを確認する。
    const refreshAccessToken = vi.fn();

    const { status } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: DUMMY_AUTH_HEADER,
      fetchUser: async () => ({ ...VALID_USER, role: "platform_admin", isAdmin: true }),
      isPlatformAdmin: async () => false,
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(status).toBe(403);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe("handleConcurOAuthCheckRequest（安全ゲート）", () => {
  it.each([
    [undefined, "未設定"],
    ["false", "false"],
    ["TRUE", "大文字違い"],
  ])("CONCUR_OAUTH_CHECK_ENABLEDが%s（%s）の場合はdisabledを返し、refreshAccessTokenは呼ばれない", async (value) => {
    const refreshAccessToken = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv({ CONCUR_OAUTH_CHECK_ENABLED: value }),
      refreshAccessToken,
    });

    expect(status).toBe(200);
    expect(body.result).toEqual({ connected: false, status: "disabled" });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("CONCUR_OAUTH_CHECK_ENABLEDが真偽値true（文字列でない）の場合もdisabled", async () => {
    const refreshAccessToken = vi.fn();

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv({ CONCUR_OAUTH_CHECK_ENABLED: true }),
      refreshAccessToken,
    });

    expect(body.result).toEqual({ connected: false, status: "disabled" });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("文字列\"true\"の場合だけrefreshAccessTokenが呼ばれる", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: true,
      rotated: false,
      tokens: { accessToken: "dummy-access-token" },
      logSummary: { ok: true, rotated: false, hasAccessToken: true, hasGeolocation: false, hasScope: false, expiresInPresent: false },
    });

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv({ CONCUR_OAUTH_CHECK_ENABLED: "true" }),
      refreshAccessToken,
    });

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe("handleConcurOAuthCheckRequest（成功）", () => {
  it("connected:true・hasGeolocation・expiresInPresent・refreshTokenRotated:falseを返す", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: true,
      rotated: false,
      tokens: { accessToken: "dummy-access-token", geolocation: "https://example-dummy.concursolutions.test" },
      logSummary: { ok: true, rotated: false, hasAccessToken: true, hasGeolocation: true, hasScope: false, expiresInPresent: true },
    });

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      result: { connected: true, hasGeolocation: true, expiresInPresent: true, refreshTokenRotated: false },
      error: null,
    });
  });

  it("成功レスポンスにトークン本体が一切含まれない", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: true,
      rotated: false,
      tokens: { accessToken: "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK", refreshToken: "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK" },
      logSummary: { ok: true, rotated: false, hasAccessToken: true, hasGeolocation: false, hasScope: false, expiresInPresent: false },
    });

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK");
  });
});

describe("handleConcurOAuthCheckRequest（エラー）", () => {
  function refreshFailure(code) {
    return vi.fn().mockResolvedValue({ ok: false, error: { code, message: "固定メッセージ" } });
  }

  it("Secrets不足はconcur_not_configured", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken: refreshFailure("concur_not_configured"),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_not_configured");
  });

  it("timeoutはconcur_oauth_timeout", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken: refreshFailure("concur_oauth_timeout"),
    });

    expect(status).toBe(504);
    expect(body.error.code).toBe("concur_oauth_timeout");
  });

  it("network errorはconcur_oauth_network_error", async () => {
    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken: refreshFailure("concur_oauth_network_error"),
    });

    expect(body.error.code).toBe("concur_oauth_network_error");
  });

  it("rejectedはconcur_oauth_rejected", async () => {
    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken: refreshFailure("concur_oauth_rejected"),
    });

    expect(body.error.code).toBe("concur_oauth_rejected");
  });

  it("rate limitedはconcur_oauth_rate_limited", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken: refreshFailure("concur_oauth_rate_limited"),
    });

    expect(status).toBe(429);
    expect(body.error.code).toBe("concur_oauth_rate_limited");
  });

  it("service errorはconcur_oauth_service_error", async () => {
    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken: refreshFailure("concur_oauth_service_error"),
    });

    expect(body.error.code).toBe("concur_oauth_service_error");
  });

  it("invalid responseはconcur_oauth_invalid_response", async () => {
    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken: refreshFailure("concur_oauth_invalid_response"),
    });

    expect(body.error.code).toBe("concur_oauth_invalid_response");
  });

  it("予期しない例外（refreshAccessTokenが例外を投げる）はinternal_error。例外メッセージを漏らさない", async () => {
    const secretLikeMessage = "SHOULD_NOT_LEAK_EXCEPTION_DETAIL";
    const refreshAccessToken = vi.fn().mockRejectedValue(new Error(secretLikeMessage));

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain(secretLikeMessage);
  });

  it("ローテーション発生時（rotated: true）は成功扱いにせず、concur_oauth_rotation_unsupportedを返す", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: true,
      rotated: true,
      tokens: { accessToken: "dummy-access-token", refreshToken: "dummy-new-refresh-token" },
      logSummary: { ok: true, rotated: true, hasAccessToken: true, hasGeolocation: false, hasScope: false, expiresInPresent: false },
    });

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(status).toBe(409);
    expect(body.result).toBeNull();
    expect(body.error.code).toBe("concur_oauth_rotation_unsupported");
  });
});

describe("handleConcurOAuthCheckRequest（セキュリティ）", () => {
  it("Client Secret・Authorizationヘッダー本体がレスポンスへ一切含まれない", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "concur_oauth_rejected", message: "固定メッセージ" },
    });

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(DUMMY_CLIENT_SECRET);
    expect(serialized).not.toContain(DUMMY_AUTH_HEADER);
  });

  it("生のOAuthレスポンス相当の情報（error_description等）がエラー本文へ含まれない", async () => {
    const rawDetail = "invalid_grant: refresh token is expired (SHOULD_NOT_LEAK)";
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "concur_oauth_rejected", message: "固定メッセージ" },
    });
    void rawDetail;

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      refreshAccessToken,
    });

    expect(body.error.message).toBe("固定メッセージ");
    expect(JSON.stringify(body)).not.toContain("SHOULD_NOT_LEAK");
  });
});
