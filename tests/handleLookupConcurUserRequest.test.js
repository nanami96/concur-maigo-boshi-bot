import { describe, it, expect, vi } from "vitest";
import { handleLookupConcurUserRequest } from "../supabase/functions/lookup-concur-user/handleLookupConcurUserRequest.js";

// 以下の値はすべてテスト専用のダミー値であり、実際のConcur側の値ではない。
const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_REFRESH_TOKEN = "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_NEW_REFRESH_TOKEN = "DUMMY_NEW_REFRESH_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_SERVICE_ROLE_KEY = "DUMMY_SERVICE_ROLE_KEY_SHOULD_NOT_LEAK";
const DUMMY_USER_NAME = "user@example.com";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const VALID_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";

function buildEnv(overrides = {}) {
  return { CONCUR_IDENTITY_LOOKUP_ENABLED: "true", ...overrides };
}

function buildAuthedInput(overrides = {}) {
  return {
    authHeader: "Bearer dummy-jwt",
    fetchUser: async () => ({ id: "platform-admin-user" }),
    isPlatformAdmin: async () => true,
    ...overrides,
  };
}

function buildLease(overrides = {}) {
  return { connectionId: "connection-1", leaseId: "lease-1", refreshToken: DUMMY_REFRESH_TOKEN, ...overrides };
}

function buildSuccessfulOAuthResult(overrides = {}) {
  return {
    ok: true,
    rotated: false,
    tokens: { accessToken: DUMMY_ACCESS_TOKEN, refreshToken: null, geolocation: DUMMY_GEOLOCATION },
    logSummary: { ok: true },
    ...overrides,
  };
}

describe("handleLookupConcurUserRequest（HTTPメソッド）", () => {
  it("POST以外はmethod_not_allowed（405）。認証・Vault・Identity APIのいずれも呼ばれない", async () => {
    const fetchUser = vi.fn();
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "GET",
      authHeader: null,
      body: { userName: DUMMY_USER_NAME },
      fetchUser,
      isPlatformAdmin: vi.fn(),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
    expect(fetchUser).not.toHaveBeenCalled();
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });
});

describe("handleLookupConcurUserRequest（認証・認可）", () => {
  it("未認証はunauthorized（401）。Vault・Identity APIは呼ばれない", async () => {
    const getRefreshTokenForEdge = vi.fn();
    const lookupUser = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      authHeader: null,
      body: { userName: DUMMY_USER_NAME },
      fetchUser: vi.fn(),
      isPlatformAdmin: vi.fn(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      lookupUser,
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    expect(lookupUser).not.toHaveBeenCalled();
  });

  it("一般ユーザーはforbidden（403）", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ isPlatformAdmin: async () => false }),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("company_admin（platform_adminではない）もforbidden（403）", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      authHeader: "Bearer dummy-jwt",
      fetchUser: async () => ({ id: "company-admin-user" }),
      isPlatformAdmin: async () => false,
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("request body内の偽roleを信用しない（isPlatformAdminの戻り値だけで判定する）", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      authHeader: "Bearer dummy-jwt",
      fetchUser: async () => ({ id: "spoofed-user" }),
      isPlatformAdmin: async () => false,
      body: { userName: DUMMY_USER_NAME, role: "platform_admin", isPlatformAdmin: true },
      env: buildEnv(),
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("platform_adminはVault・Identity APIの呼び出しへ進める", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const refreshAccessToken = vi.fn().mockResolvedValue(buildSuccessfulOAuthResult());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const lookupUser = vi.fn().mockResolvedValue({ ok: true, userId: VALID_USER_ID });

    const { status } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge,
      refreshAccessToken,
      completeOAuthRefresh,
      lookupUser,
    });

    expect(status).toBe(200);
    expect(getRefreshTokenForEdge).toHaveBeenCalledTimes(1);
  });
});

describe("handleLookupConcurUserRequest（安全ゲート）", () => {
  it("CONCUR_IDENTITY_LOOKUP_ENABLEDが無効の場合、found:falseかつVault・OAuth・Identity APIのいずれも呼ばない", async () => {
    const getRefreshTokenForEdge = vi.fn();
    const refreshAccessToken = vi.fn();
    const lookupUser = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv({ CONCUR_IDENTITY_LOOKUP_ENABLED: undefined }),
      getRefreshTokenForEdge,
      refreshAccessToken,
      lookupUser,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ result: { found: false, status: "disabled" }, error: null });
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(lookupUser).not.toHaveBeenCalled();
  });

  it("CONCUR_OAUTH_CHECK_ENABLEDが\"true\"でも、このFunction専用のフラグが無ければ無効のまま", async () => {
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: { CONCUR_OAUTH_CHECK_ENABLED: "true" },
      getRefreshTokenForEdge,
    });

    expect(status).toBe(200);
    expect(body.result.status).toBe("disabled");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });
});

describe("handleLookupConcurUserRequest（入力検証）", () => {
  it("userNameが無い場合はconcur_identity_invalid_request（400）。Vaultは呼ばれない", async () => {
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: {},
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_identity_invalid_request");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("userNameが空白のみの場合もconcur_identity_invalid_request。Vaultは呼ばれない", async () => {
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: "   " },
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_identity_invalid_request");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("bodyがnull（JSONパース失敗相当）の場合もconcur_identity_invalid_request", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: null,
      env: buildEnv(),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_identity_invalid_request");
  });

  it("入力検証で拒否された場合、入力値そのものをレスポンスへ反射しない", async () => {
    const secretLikeInput = "SHOULD_NOT_BE_REFLECTED_INPUT";
    const { body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: `${secretLikeInput}%` },
      env: buildEnv(),
    });

    expect(JSON.stringify(body)).not.toContain(secretLikeInput);
  });
});

describe("handleLookupConcurUserRequest（Vault・OAuth連携）", () => {
  it("getRefreshTokenForEdgeがnullを返す場合（未接続・ロック中）はconcur_oauth_not_connected。OAuth・Identity APIは呼ばれない", async () => {
    const refreshAccessToken = vi.fn();
    const lookupUser = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(null),
      refreshAccessToken,
      lookupUser,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(lookupUser).not.toHaveBeenCalled();
  });

  it("getRefreshTokenForEdgeが例外を投げた場合はinternal_error", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockRejectedValue(new Error("db error")),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
  });

  it("OAuth（refreshAccessToken）が失敗した場合、元のエラーコードを返し、リースを解放（success:false）する。Identity APIへは進まない", async () => {
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const lookupUser = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "concur_oauth_rejected", message: "Concurの認証情報が拒否されました。" },
      }),
      completeOAuthRefresh,
      lookupUser,
    });

    expect(status).toBe(502);
    expect(body.error.code).toBe("concur_oauth_rejected");
    expect(completeOAuthRefresh).toHaveBeenCalledWith({
      connectionId: "connection-1",
      leaseId: "lease-1",
      success: false,
      newRefreshToken: null,
      errorCode: "concur_oauth_rejected",
    });
    expect(lookupUser).not.toHaveBeenCalled();
  });

  it("refreshAccessTokenが例外を投げた場合、リース解放をベストエフォートで試み、internal_errorを返す", async () => {
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockRejectedValue(new Error("boom")),
      completeOAuthRefresh,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(completeOAuthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCode: "internal_error" }),
    );
  });

  it("completeOAuthRefreshが例外を投げた場合（Vault更新自体が失敗）はconcur_oauth_storage_failed。Identity APIへは進まない", async () => {
    const lookupUser = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockRejectedValue(new Error("db error")),
      lookupUser,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_oauth_storage_failed");
    expect(lookupUser).not.toHaveBeenCalled();
  });

  it("completeOAuthRefreshがfalseを返す場合（lease不一致）はconcur_oauth_completion_failed。Identity APIへは進まない", async () => {
    const lookupUser = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(false),
      lookupUser,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_oauth_completion_failed");
    expect(lookupUser).not.toHaveBeenCalled();
  });

  it("ローテーション（新しいrefresh_tokenあり）の場合、completeOAuthRefreshへ新Tokenを渡す", async () => {
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);

    await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(
        buildSuccessfulOAuthResult({ rotated: true, tokens: { accessToken: DUMMY_ACCESS_TOKEN, refreshToken: DUMMY_NEW_REFRESH_TOKEN, geolocation: DUMMY_GEOLOCATION } }),
      ),
      completeOAuthRefresh,
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_USER_ID }),
    });

    expect(completeOAuthRefresh).toHaveBeenCalledWith({
      connectionId: "connection-1",
      leaseId: "lease-1",
      success: true,
      newRefreshToken: DUMMY_NEW_REFRESH_TOKEN,
      errorCode: null,
    });
  });
});

describe("handleLookupConcurUserRequest（Identity API連携・保存成功後にのみ進む）", () => {
  it("保存成功後、lookupUserへgeolocation・accessToken・userNameを渡す", async () => {
    const lookupUser = vi.fn().mockResolvedValue({ ok: true, userId: VALID_USER_ID });

    await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser,
    });

    expect(lookupUser).toHaveBeenCalledTimes(1);
    expect(lookupUser).toHaveBeenCalledWith(
      expect.objectContaining({ geolocation: DUMMY_GEOLOCATION, accessToken: DUMMY_ACCESS_TOKEN, userName: DUMMY_USER_NAME }),
    );
  });

  it("1件ヒット（成功）した場合、found:true・hasUserId:true・multipleMatches:falseを返す", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_USER_ID }),
    });

    expect(status).toBe(200);
    expect(body).toEqual({ result: { found: true, hasUserId: true, multipleMatches: false }, error: null });
  });

  it("成功レスポンスに実際のuserID（UUID文字列）が含まれない", async () => {
    const { body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_USER_ID }),
    });

    expect(JSON.stringify(body)).not.toContain(VALID_USER_ID);
  });

  it("0件（concur_user_not_found）はそのままエラーコードを返す", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "concur_user_not_found", message: "指定された利用者情報が見つかりませんでした。" },
      }),
    });

    expect(status).toBe(404);
    expect(body.error.code).toBe("concur_user_not_found");
  });

  it("複数件（concur_user_ambiguous）はそのままエラーコードを返す", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "concur_user_ambiguous", message: "指定された条件に一致する利用者が複数見つかりました。より詳細な条件を指定してください。" },
      }),
    });

    expect(status).toBe(409);
    expect(body.error.code).toBe("concur_user_ambiguous");
  });

  it("lookupUserが例外を投げた場合はinternal_error", async () => {
    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockRejectedValue(new Error("boom")),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
  });

  it("保存に失敗した場合（completion_failed/storage_failed）は、その時点でconnected:true相当を返さない（既にconcur_oauth系のテストで検証済みだが、Identity API側の成功が影響しないことも確認）", async () => {
    const lookupUser = vi.fn();

    const { status, body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(false),
      lookupUser,
    });

    expect(body.result).toBeNull();
    expect(status).not.toBe(200);
    expect(lookupUser).not.toHaveBeenCalled();
  });
});

describe("handleLookupConcurUserRequest（セキュリティ・非露出）", () => {
  it("Access Token・Refresh Token・新Refresh Token・service role key相当の値がレスポンスへ一切含まれない（成功時）", async () => {
    const { body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv({ SUPABASE_SERVICE_ROLE_KEY: DUMMY_SERVICE_ROLE_KEY }),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(
        buildSuccessfulOAuthResult({ rotated: true, tokens: { accessToken: DUMMY_ACCESS_TOKEN, refreshToken: DUMMY_NEW_REFRESH_TOKEN, geolocation: DUMMY_GEOLOCATION } }),
      ),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_USER_ID }),
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(serialized).not.toContain(DUMMY_REFRESH_TOKEN);
    expect(serialized).not.toContain(DUMMY_NEW_REFRESH_TOKEN);
    expect(serialized).not.toContain(DUMMY_SERVICE_ROLE_KEY);
    expect(serialized).not.toContain(VALID_USER_ID);
  });

  it("Access Token・Refresh Tokenがレスポンスへ一切含まれない（各エラー経路でも）", async () => {
    const scenarios = [
      {
        name: "OAuth拒否",
        setup: {
          getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
          refreshAccessToken: vi.fn().mockResolvedValue({ ok: false, error: { code: "concur_oauth_rejected", message: "x" } }),
          completeOAuthRefresh: vi.fn().mockResolvedValue(true),
        },
      },
      {
        name: "Identity API拒否",
        setup: {
          getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
          refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
          completeOAuthRefresh: vi.fn().mockResolvedValue(true),
          lookupUser: vi.fn().mockResolvedValue({ ok: false, error: { code: "concur_identity_rejected", message: "x" } }),
        },
      },
    ];

    for (const scenario of scenarios) {
      const { body } = await handleLookupConcurUserRequest({
        method: "POST",
        ...buildAuthedInput(),
        body: { userName: DUMMY_USER_NAME },
        env: buildEnv(),
        ...scenario.setup,
      });

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
      expect(serialized).not.toContain(DUMMY_REFRESH_TOKEN);
    }
  });

  it("userNameの値がレスポンスへ一切含まれない（成功時）", async () => {
    const { body } = await handleLookupConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      body: { userName: DUMMY_USER_NAME },
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_USER_ID }),
    });

    expect(JSON.stringify(body)).not.toContain(DUMMY_USER_NAME);
  });
});
