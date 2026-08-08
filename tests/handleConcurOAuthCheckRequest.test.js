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

// 【会社別OAuth接続対応】以前はcompanyIdを常にnull固定で呼び出し元が直接
// 渡していたが、resolveOAuthCompanyId({ userId, companyCode })
// （resolve_concur_oauth_company_id RPC相当）がauthResult.user.idと
// リクエスト本文のcompanyCodeから解決したUUIDだけをgetRefreshTokenForEdgeへ
// 渡すようになった。DUMMY_COMPANY_A_UUID等は実際のUUID形式である必要はなく、
// テスト専用のダミー値だが、他社（DUMMY_COMPANY_B_UUID）と衝突しない値に
// することで「A社のリクエストでB社のUUIDが使われていないか」を検証できる。
const DUMMY_COMPANY_CODE = "connect-company";
const DUMMY_COMPANY_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DUMMY_COMPANY_B_CODE = "other-company";
const DUMMY_COMPANY_B_UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function buildEnv(overrides = {}) {
  return {
    CONCUR_CLIENT_ID: "dummy-client-id",
    CONCUR_CLIENT_SECRET: "dummy-client-secret",
    CONCUR_TOKEN_URL: "https://example-dummy.concursolutions.test/oauth2/v0/token",
    CONCUR_OAUTH_CHECK_ENABLED: "true",
    ...overrides,
  };
}

function parseBodyFor(value) {
  return async () => value;
}

// resolveOAuthCompanyIdの既定モック：DUMMY_COMPANY_CODEが指定された場合だけ
// DUMMY_COMPANY_UUIDを返す（companyCodeを無視して固定値を返す危険な実装では
// ないことを、この既定モック自体でも体現する）。
function defaultResolveOAuthCompanyId() {
  return vi.fn(async ({ companyCode }) => (companyCode === DUMMY_COMPANY_CODE ? DUMMY_COMPANY_UUID : null));
}

function buildAuthedInput(overrides = {}) {
  return {
    authHeader: DUMMY_AUTH_HEADER,
    fetchUser: async () => VALID_USER,
    isPlatformAdmin: async () => true,
    parseBody: parseBodyFor({ companyCode: DUMMY_COMPANY_CODE }),
    resolveOAuthCompanyId: defaultResolveOAuthCompanyId(),
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
  it("GETはmethod_not_allowed（405）。認可・入力検証・Vault RPCのいずれも呼ばれない", async () => {
    const isPlatformAdmin = vi.fn();
    const getRefreshTokenForEdge = vi.fn();
    const resolveOAuthCompanyId = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "GET",
      ...buildAuthedInput({ isPlatformAdmin, resolveOAuthCompanyId }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
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
  it("Authorizationヘッダーが無い場合は401。isPlatformAdmin・入力検証・Vault RPCのいずれも呼ばれない", async () => {
    const isPlatformAdmin = vi.fn();
    const getRefreshTokenForEdge = vi.fn();
    const resolveOAuthCompanyId = vi.fn();
    const parseBody = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: null,
      fetchUser: vi.fn(),
      isPlatformAdmin,
      parseBody,
      env: buildEnv(),
      resolveOAuthCompanyId,
      getRefreshTokenForEdge,
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(isPlatformAdmin).not.toHaveBeenCalled();
    expect(parseBody).not.toHaveBeenCalled();
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("一般ユーザー（platform_adminでない）は403。入力検証・Vault関連の管理RPCはいずれも呼ばれない", async () => {
    const getRefreshTokenForEdge = vi.fn();
    const completeOAuthRefresh = vi.fn();
    const resolveOAuthCompanyId = vi.fn();
    const parseBody = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      authHeader: DUMMY_AUTH_HEADER,
      fetchUser: async () => VALID_USER,
      isPlatformAdmin: async () => false,
      parseBody,
      env: buildEnv(),
      resolveOAuthCompanyId,
      getRefreshTokenForEdge,
      completeOAuthRefresh,
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(parseBody).not.toHaveBeenCalled();
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
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
      parseBody: vi.fn(),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(403);
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("platform_adminは入力検証・安全ゲート・Vault RPCまで到達できる", async () => {
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

describe("handleConcurOAuthCheckRequest（入力検証：会社別OAuth接続対応で追加）", () => {
  it("parseBodyが例外を投げる（不正なJSON）場合はinvalid_json（400）。resolveOAuthCompanyId・Vaultは呼ばれない", async () => {
    const resolveOAuthCompanyId = vi.fn();
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({
        parseBody: async () => {
          throw new SyntaxError("bad json");
        },
        resolveOAuthCompanyId,
      }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_json");
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("companyCodeが無い場合はconcur_oauth_check_invalid_request（400）。resolveOAuthCompanyId・Vaultは呼ばれない", async () => {
    const resolveOAuthCompanyId = vi.fn();
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ parseBody: parseBodyFor({}), resolveOAuthCompanyId }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_oauth_check_invalid_request");
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("companyCodeが空白のみの場合もconcur_oauth_check_invalid_request", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ parseBody: parseBodyFor({ companyCode: "   " }) }),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn(),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_oauth_check_invalid_request");
  });
});

describe("handleConcurOAuthCheckRequest（安全ゲート）", () => {
  it.each([undefined, "false", "TRUE", true])(
    "CONCUR_OAUTH_CHECK_ENABLEDが%sの場合はdisabledを返し、resolveOAuthCompanyId・Vault RPCは呼ばれない",
    async (value) => {
      const getRefreshTokenForEdge = vi.fn();
      const resolveOAuthCompanyId = vi.fn();

      const { status, body } = await handleConcurOAuthCheckRequest({
        method: "POST",
        ...buildAuthedInput({ resolveOAuthCompanyId }),
        env: buildEnv({ CONCUR_OAUTH_CHECK_ENABLED: value }),
        getRefreshTokenForEdge,
      });

      expect(status).toBe(200);
      expect(body.result).toEqual({ connected: false, status: "disabled" });
      expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
      expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    },
  );

  it("ゲートOFFでもcompanyCode自体の検証は行われる（不正な入力はdisabledより先にvalidation errorになる）", async () => {
    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ parseBody: parseBodyFor({}) }),
      env: buildEnv({ CONCUR_OAUTH_CHECK_ENABLED: "false" }),
      getRefreshTokenForEdge: vi.fn(),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_oauth_check_invalid_request");
  });
});

describe("handleConcurOAuthCheckRequest（会社別OAuth接続の境界：company-scoped resolveOAuthCompanyId→getRefreshTokenForEdge）", () => {
  it("resolveOAuthCompanyIdへ、JWTで検証済みのuserIdと本文のcompanyCode（company_code）が渡る", async () => {
    const resolveOAuthCompanyId = vi.fn().mockResolvedValue(DUMMY_COMPANY_UUID);
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(resolveOAuthCompanyId).toHaveBeenCalledWith({ userId: VALID_USER.id, companyCode: DUMMY_COMPANY_CODE });
  });

  it("A社のリクエストは、resolveOAuthCompanyIdが返したA社UUIDだけをgetRefreshTokenForEdgeへ渡す", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_UUID });
  });

  it("B社のリクエストは、resolveOAuthCompanyIdが返したB社UUIDだけをgetRefreshTokenForEdgeへ渡す（A社のUUIDが混ざらない）", async () => {
    const resolveOAuthCompanyId = vi.fn(async ({ companyCode }) => {
      if (companyCode === DUMMY_COMPANY_CODE) return DUMMY_COMPANY_UUID;
      if (companyCode === DUMMY_COMPANY_B_CODE) return DUMMY_COMPANY_B_UUID;
      return null;
    });
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId, parseBody: parseBodyFor({ companyCode: DUMMY_COMPANY_B_CODE }) }),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_B_UUID });
    expect(getRefreshTokenForEdge).not.toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_UUID });
  });

  it("A社リクエストでA社所属userかつA社companyCode → A社UUIDのみ使用（複数社所属でも一意に解決される）", async () => {
    // resolveOAuthCompanyIdはuserId・companyCodeの組み合わせで一意に決まる
    // 実装（実際のRPCと同じ挙動）を使い、同じuserがA社・B社どちらの
    // companyCodeを指定するかによって解決先が変わることを確認する。
    const resolveOAuthCompanyId = vi.fn(async ({ userId, companyCode }) => {
      if (userId !== VALID_USER.id) return null;
      if (companyCode === DUMMY_COMPANY_CODE) return DUMMY_COMPANY_UUID;
      if (companyCode === DUMMY_COMPANY_B_CODE) return DUMMY_COMPANY_B_UUID;
      return null;
    });
    const getRefreshTokenForEdgeForA = vi.fn().mockResolvedValue(buildLease());
    const getRefreshTokenForEdgeForB = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId, getRefreshTokenForEdge: getRefreshTokenForEdgeForA }),
      env: buildEnv(),
      getRefreshTokenForEdge: getRefreshTokenForEdgeForA,
      completeOAuthRefresh,
      refreshAccessToken,
    });
    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({
        resolveOAuthCompanyId,
        parseBody: parseBodyFor({ companyCode: DUMMY_COMPANY_B_CODE }),
      }),
      env: buildEnv(),
      getRefreshTokenForEdge: getRefreshTokenForEdgeForB,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(getRefreshTokenForEdgeForA).toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_UUID });
    expect(getRefreshTokenForEdgeForB).toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_B_UUID });
  });

  it("A社userがB社のcompanyCodeを指定（未所属）→ resolveOAuthCompanyIdがnullを返し拒否される（concur_oauth_not_connected）", async () => {
    // 実際のresolve_concur_oauth_company_id RPCは「p_user_idがp_company_codeの
    // 会社へ所属しているか」を検証し、所属していなければNULLを返す設計。
    // ここではその挙動をモックで再現する。
    const resolveOAuthCompanyId = vi.fn(async ({ companyCode }) =>
      companyCode === DUMMY_COMPANY_CODE ? DUMMY_COMPANY_UUID : null,
    );
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({
        resolveOAuthCompanyId,
        parseBody: parseBodyFor({ companyCode: DUMMY_COMPANY_B_CODE }),
      }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("resolveOAuthCompanyIdがnullを返す（未解決・未所属・接続無しのいずれも含む）場合、Vaultリース取得自体を行わずconcur_oauth_not_connectedを返す（既定接続へフォールバックしない）", async () => {
    const resolveOAuthCompanyId = vi.fn().mockResolvedValue(null);
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("resolveOAuthCompanyIdが空文字を返した場合も未解決として扱いfail-closed", async () => {
    const resolveOAuthCompanyId = vi.fn().mockResolvedValue("");
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("resolveOAuthCompanyId自体が例外を投げた場合はinternal_error。Vaultリース取得へは進まない", async () => {
    const resolveOAuthCompanyId = vi.fn().mockRejectedValue(new Error("db error"));
    const getRefreshTokenForEdge = vi.fn();

    const { status, body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
  });

  it("リクエスト本文のcompanyCode（company_codeの文字列）がそのままgetRefreshTokenForEdgeへ渡ることはない（company_codeとcompany UUIDの取り違え防止）", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(getRefreshTokenForEdge).not.toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_CODE });
    expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_UUID });
  });

  it("クライアントがcompany UUIDらしき値を本文に紛れ込ませても、それは使われない（常にresolveOAuthCompanyIdの戻り値だけを使う）", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());
    const attackerSuppliedUuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput({
        // companyCodeはcompany_code（スラッグ）を指す契約であり、リクエスト
        // スキーマにcompany UUID用の別フィールドは存在しない
        // （validateConcurOAuthCheckRequest.js参照）。ここではその上で、
        // 万一クライアントが無関係な値をどこかに含めても無視されることを
        // 示すため、スキーマ外のフィールドとして紛れ込ませる。
        parseBody: parseBodyFor({ companyCode: DUMMY_COMPANY_CODE, companyId: attackerSuppliedUuid }),
      }),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(getRefreshTokenForEdge).not.toHaveBeenCalledWith({ companyId: attackerSuppliedUuid });
    expect(getRefreshTokenForEdge).toHaveBeenCalledWith({ companyId: DUMMY_COMPANY_UUID });
  });

  it("応答・ログにcompany UUID（resolveOAuthCompanyIdの戻り値）が一切含まれない", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(allLoggedText).not.toContain(DUMMY_COMPANY_UUID);
    expect(JSON.stringify(body)).not.toContain(DUMMY_COMPANY_UUID);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("認証済みuser.id（UUID）自体もレスポンスへ一切含まれない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult());

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(JSON.stringify(body)).not.toContain(VALID_USER.id);
  });
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
      result: {
        connected: true,
        hasGeolocation: true,
        expiresInPresent: true,
        refreshTokenRotated: false,
        scopePresent: false,
        hasQuickExpenseWriteScope: false,
        hasUserReadScope: false,
        hasIdentityUserIdsReadScope: false,
      },
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
});

describe("handleConcurOAuthCheckRequest（Quick Expense／Identity実通信前チェック：必要scope）", () => {
  it("必要な3scopeすべてを含む場合、3つともtrueを返す", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(
      successfulOAuthResult({
        tokens: { accessToken: "dummy-access-token", scope: "quickexpense.writeonly user.read identity.user.ids.read" },
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

    expect(body.result.scopePresent).toBe(true);
    expect(body.result.hasQuickExpenseWriteScope).toBe(true);
    expect(body.result.hasUserReadScope).toBe(true);
    expect(body.result.hasIdentityUserIdsReadScope).toBe(true);
  });

  it("1つだけ含む場合、該当するものだけtrueを返す", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(
      successfulOAuthResult({ tokens: { accessToken: "dummy-access-token", scope: "expense.report.read user.read" } }),
    );

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(body.result.scopePresent).toBe(true);
    expect(body.result.hasQuickExpenseWriteScope).toBe(false);
    expect(body.result.hasUserReadScope).toBe(true);
    expect(body.result.hasIdentityUserIdsReadScope).toBe(false);
  });

  it("scope自体がtoken応答に無い場合、scopePresent:falseかつ3つともfalseを返す", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(successfulOAuthResult({ tokens: { accessToken: "dummy-access-token" } }));

    const { body } = await handleConcurOAuthCheckRequest({
      method: "POST",
      ...buildAuthedInput(),
      env: buildEnv(),
      getRefreshTokenForEdge,
      completeOAuthRefresh,
      refreshAccessToken,
    });

    expect(body.result.scopePresent).toBe(false);
    expect(body.result.hasQuickExpenseWriteScope).toBe(false);
    expect(body.result.hasUserReadScope).toBe(false);
    expect(body.result.hasIdentityUserIdsReadScope).toBe(false);
  });

  it("scopeの生値・他のscope名がレスポンスへ一切含まれない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(
      successfulOAuthResult({
        tokens: {
          accessToken: "dummy-access-token",
          scope: "quickexpense.writeonly user.read identity.user.ids.read company.secret.scope",
        },
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
    expect(serialized).not.toContain("company.secret.scope");
    expect(serialized).not.toContain("quickexpense.writeonly user.read");
    expect(Object.keys(body.result).sort()).toEqual(
      [
        "connected",
        "hasGeolocation",
        "expiresInPresent",
        "refreshTokenRotated",
        "scopePresent",
        "hasQuickExpenseWriteScope",
        "hasUserReadScope",
        "hasIdentityUserIdsReadScope",
      ].sort(),
    );
  });

  it("Access Token・Refresh Tokenの値がレスポンスへ一切含まれない", async () => {
    const getRefreshTokenForEdge = vi.fn().mockResolvedValue(buildLease());
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const refreshAccessToken = vi.fn().mockResolvedValue(
      successfulOAuthResult({
        tokens: { accessToken: "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK", scope: "quickexpense.writeonly" },
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

    expect(JSON.stringify(body)).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
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
    expect(completeOAuthRefresh).not.toHaveBeenCalled();
  });

  it("（防御的コード）getRefreshTokenForEdgeがconnectionId／leaseIdはあるがrefreshTokenを含まない不正な形の値を返してもconcur_oauth_not_connectedとして安全に扱う", async () => {
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
