import { describe, it, expect, vi } from "vitest";
import { handleConcurOAuthCheckRequest } from "../supabase/functions/check-concur-oauth/handleConcurOAuthCheckRequest.js";

// 以下の認証情報・トークン値はすべてテスト専用のダミー値であり、実際の
// Concur側の値ではない。本物のtoken endpointへは一切通信しない
// （refreshAccessToken・getRefreshTokenForEdge・completeOAuthRefreshを
// 常にモックへ差し替える）。

const VALID_USER = { id: "user-1" };
const DUMMY_AUTH_HEADER = "Bearer DUMMY_JWT_SHOULD_NOT_LEAK";
const DUMMY_CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const DUMMY_LEASE_ID = "22222222-2222-2222-2222-222222222222";
const DUMMY_CURRENT_REFRESH_TOKEN = "DUMMY_CURRENT_REFRESH_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_SERVICE_ROLE_KEY = "DUMMY_SERVICE_ROLE_KEY_SHOULD_NOT_LEAK";

function buildEnv(overrides = {}) {
  return {
    CONCUR_CLIENT_ID: "dummy-client-id",
    CONCUR_CLIENT_SECRET: "dummy-client-secret",
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

function buildLease(overrides = {}) {
  return {
    connectionId: DUMMY_CONNECTION_ID,
    leaseId: DUMMY_LEASE_ID,
    refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
    ...overrides,
  };
}

function successfulOAuthResult(overrides = {}) {
  return {
    ok: true,
    rotated: false,
    tokens: { accessToken: "dummy-access-token" },
    logSummary: { ok: true, rotated: false, hasAccessToken: true, hasGeolocation: true, hasScope: false, expiresInPresent: true },
    ...overrides,
  };
}

describe("handleConcurOAuthCheckRequest（HTTP）", () => {
  it("GETはmethod_not_allowed（405）。認可・Vault RPCのいずれも呼ばれない", async () => {
    const isPlatformAdmin = vi.fn();
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "GET",
      ...buildAuthedInput({ isPlatformAdmin }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
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
  it("Authorizationヘッダーが無い場合は401。isPlatformAdmin・Vault RPCのいずれも呼ばれない", async () => {
    const isPlatformAdmin = vi.fn();
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: null,
      fetchUser: vi.fn(),
      isPlatformAdmin,
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("一般ユーザー（platform_adminでない）は403。Vault関連の管理RPCはいずれも呼ばれない", async () => {
    const getRefreshTokenForEdge = vi.fn();
    const completeOAuthRefresh = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: DUMMY_AUTH_HEADER,
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => false,
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    expect(completeOAuthRefresh).not.toHaveBeenCalled();
  });

  it("company_admin（platform_adminではない）も403。管理RPCは呼ばれない", async () => {
    const getRefreshTokenForEdge = vi.fn();

    const { status } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: DUMMY_AUTH_HEADER,
      fetchUser: async () => ({ ...VALID_USER, companyRole: "admin" }),
      isPlatformAdmin: async () => false,
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(403);
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("platform_adminは安全ゲート・Vault RPCまで到達できる", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(status).toBe(200);
    expect(body.result.connected).toBe(true);
    expect(getRefreshTokenForEdge).toHaveBeenCalledTimes(1);
  });
});

describe("handleConcurOAuthCheckRequest（安全ゲート）", () => {
  it.each([undefined, "false", "TRUE", true])(
    "CONCUR_OAUTH_CHECK_ENABLEDが%sの場合はdisabledを返し、Vault RPCは呼ばれない",
    async (value) => {
      const getRefreshTokenForEdge = vi.fn();

      const { status, body } = await handleConcurOAuthCheckRequest({
        method: "POST",
        ...buildAuthedInput(),
        env: buildEnv({ CONCUR_OAUTH_CHECK_ENABLED: value }),
        getRefreshTokenForEdge,
      });

      expect(status).toBe(200);
      expect(body.result).toEqual({ connected: false, status: "disabled" });
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    },
  );
});

describe("handleConcurOAuthCheckRequest（Token取得〜成功）", () => {
  it("Token取得成功→OAuth成功→保存成功でconnected:trueを返す", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      result: { connected: true, hasGeolocation: true, expiresInPresent: true, refreshTokenRotated: false },
      error: null,
    });
    expect(refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: DUMMY_CURRENT_REFRESH_TOKEN }),
    );
    expect(completeOAuthRefresh).toHaveBeenCalledWith({
      connectionId: DUMMY_CONNECTION_ID,
      leaseId: DUMMY_LEASE_ID,
      success: true,
      newRefreshToken: null,
      errorCode: null,
    });
  });

  it("新しいrefresh_tokenが返った場合、completeOAuthRefreshへnewRefreshTokenを渡し、refreshTokenRotated:trueを返す", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(
      successfulOAuthResult({ rotated: true, tokens: { accessToken: "dummy-access-token", refreshToken: "DUMMY_NEW_REFRESH_TOKEN" } }),
    );

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(body.result.refreshTokenRotated).toBe(true);
    expect(completeOAuthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ newRefreshToken: "DUMMY_NEW_REFRESH_TOKEN", success: true }),
    );
  });

  it("会社別接続を指定した場合、companyIdがgetRefreshTokenForEdgeへそのまま渡される", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      companyId: "dummy-company-id",
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: "dummy-company-id" });
  });
});

describe("handleConcurOAuthCheckRequest（未接続・ロック中）", () => {
  it("getRefreshTokenForEdgeがnullを返す場合（未登録）はconcur_oauth_not_connected。OAuth通信は発生しない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(null);
    const refreshAccessToken = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      refreshAccessToken,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("ロック中（他のリクエストが処理中）でgetRefreshTokenForEdgeが0行相当を返す場合も同じconcur_oauth_not_connected（区別しない）", async () => {
    // 実際のRPCは0行の場合indexアダプタがnullへ正規化する想定。ここでは
    // そのnull結果を直接モックし、「未登録」と「ロック中」がハンドラーの
    // 外部レスポンス上は区別されないことを確認する。
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(null);

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
  });

  it("Vault Secretが不在／空文字（RPC側で単一UPDATE...FROM...RETURNINGが0行になるケース）でも同じconcur_oauth_not_connected。OAuth通信は発生しない", async () => {
    // get_concur_refresh_token_for_edge()の改訂後は、Vault Secretが存在しない・
    // 空文字・空白のみの場合、RPC自体が0行を返す（接続行のstatus等は一切
    // 変更されない）。アダプタ層ではこれも「未登録」「ロック中」と同じnullとして
    // 表れるため、ハンドラー側の外部レスポンスは変わらないことを確認する。
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(null);
    const refreshAccessToken = vi.fn();
    const completeOAuthRefresh = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      refreshAccessToken,
      completeOAuthRefresh,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(refreshAccessToken).not.toHaveBeenCalled();
    // Vault Secret不在の場合、RPC側でリース自体が獲得されない（改訂後の設計）
    // ため、Edge Function側がcompleteを呼んでリースを解放する必要も無い。
    expect(completeOAuthRefresh).not.toHaveBeenCalled();
  });

  it("（防御的コード）getRefreshTokenForEdgeがconnectionId／leaseIdはあるがrefreshTokenを含まない不正な形の値を返してもconcur_oauth_not_connectedとして安全に扱う", async () => {
    // 改訂後のRPC設計では本来起こり得ない形（アダプタ側のバグ等を想定した
    // 防御的なテスト）。handleConcurOAuthCheckRequest.js側のガード
    // （!lease.refreshToken）が引き続き機能することを確認する。
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue({
      connectionId: "dummy-connection-id",
      leaseId: "dummy-lease-id",
      refreshToken: "",
    });
    const refreshAccessToken = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      refreshAccessToken,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("getRefreshTokenForEdgeが例外を投げた場合はinternal_error", async () => {
    const getRefreshTokenForEdge = vi.fn().mockRejectedValue(new Error("db error"));

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
  });
});

describe("handleConcurOAuthCheckRequest（OAuth失敗）", () => {
  it("OAuth失敗時はcompleteOAuthRefresh(success:false, errorCode)を呼び、元のエラーを返す", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "concur_oauth_rejected", message: "固定メッセージ" },
    });

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(status).toBe(502);
    expect(body.error.code).toBe("concur_oauth_rejected");
    expect(completeOAuthRefresh).toHaveBeenCalledWith({
      connectionId: DUMMY_CONNECTION_ID,
      leaseId: DUMMY_LEASE_ID,
      success: false,
      newRefreshToken: null,
      errorCode: "concur_oauth_rejected",
    });
  });

  it("OAuth失敗時、completeOAuthRefresh自体が失敗しても元のOAuthエラーを優先して返す（ベストエフォート解放）", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockRejectedValue(new Error("release failed"));
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "concur_oauth_timeout", message: "固定メッセージ" },
    });

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(status).toBe(504);
    expect(body.error.code).toBe("concur_oauth_timeout");
  });

  it("refreshAccessToken自体が予期しない例外を投げた場合はinternal_errorで、リース解放を試みる", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockRejectedValue(new Error("unexpected"));

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(completeOAuthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCode: "internal_error" }),
    );
  });
});

describe("handleConcurOAuthCheckRequest（保存失敗）", () => {
  it("completeOAuthRefreshがfalseを返す場合（lease不一致）はconcur_oauth_completion_failedを返し、成功として扱わない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(false);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_oauth_completion_failed");
    expect(body.result).toBeNull();
  });

  it("completeOAuthRefreshが例外を投げる場合（Vault更新自体が失敗）はconcur_oauth_storage_failedを返し、成功として扱わない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockRejectedValue(new Error("vault update failed"));
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_oauth_storage_failed");
    expect(body.result).toBeNull();
  });
});

describe("handleConcurOAuthCheckRequest（セキュリティ）", () => {
  it("Access Token・Refresh Token・Authorizationヘッダー本体がレスポンスへ一切含まれない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(
      successfulOAuthResult({
        tokens: { accessToken: "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK", refreshToken: DUMMY_CURRENT_REFRESH_TOKEN },
      }),
    );

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain(DUMMY_CURRENT_REFRESH_TOKEN);
    expect(serialized).not.toContain(DUMMY_AUTH_HEADER);
  });

  it("service role keyに相当する値はこの関数の入出力のどこにも現れない（envにも含まれない設計）", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());
    const env = buildEnv();
    // service role keyはindex.ts側でDeno.envから直接読み、buildConcurEnv()の
    // 戻り値（このテストが使うenv）には含まれない設計であることの確認。
    expect(env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env,
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(JSON.stringify(body)).not.toContain(DUMMY_SERVICE_ROLE_KEY);
  });

  it("エラー本文に生のOAuthレスポンス相当の情報（error_description等）が含まれない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "concur_oauth_rejected", message: "固定メッセージ" },
    });

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(body.error.message).toBe("固定メッセージ");
  });
});
