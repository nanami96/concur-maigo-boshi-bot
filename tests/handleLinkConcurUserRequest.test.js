import { describe, it, expect, vi } from "vitest";
import { handleLinkConcurUserRequest } from "../supabase/functions/link-concur-user/handleLinkConcurUserRequest.js";

// 以下の値はすべてテスト専用のダミー値であり、実際のConcur側の値ではない。
const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_REFRESH_TOKEN = "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_NEW_REFRESH_TOKEN = "DUMMY_NEW_REFRESH_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_CONCUR_LOGIN_ID = "user@example.com";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const VALID_CONCUR_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";
const AUTHED_USER_ID = "authed-user-id";

const DUMMY_COMPANY_CODE = "connect-company";
const DUMMY_COMPANY_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function buildEnv(overrides = {}) {
  return { CONCUR_USER_LINK_ENABLED: "true", ...overrides };
}

function defaultResolveOAuthCompanyId() {
  return vi.fn(async ({ companyCode }) => (companyCode === DUMMY_COMPANY_CODE ? DUMMY_COMPANY_UUID : null));
}

function buildAuthedInput(overrides = {}) {
  return {
    authHeader: "Bearer dummy-jwt",
    fetchUser: async () => ({ id: AUTHED_USER_ID }),
    resolveOAuthCompanyId: defaultResolveOAuthCompanyId(),
    saveConcurUserLink: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildValidBody(overrides = {}) {
  return { companyCode: DUMMY_COMPANY_CODE, concurLoginId: DUMMY_CONCUR_LOGIN_ID, ...overrides };
}

function buildParseBody(body = buildValidBody()) {
  return vi.fn().mockResolvedValue(body);
}

function buildLease(overrides = {}) {
  return { connectionId: "connection-1", leaseId: "lease-1", refreshToken: DUMMY_REFRESH_TOKEN, ...overrides };
}

function buildSuccessfulOAuthResult(overrides = {}) {
  return {
    ok: true,
    rotated: false,
    tokens: { accessToken: DUMMY_ACCESS_TOKEN, refreshToken: null, geolocation: DUMMY_GEOLOCATION },
    ...overrides,
  };
}

describe("handleLinkConcurUserRequest（HTTPメソッド）", () => {
  it("POST以外はmethod_not_allowed（405）。認証・resolveOAuthCompanyId・Vault・Identity API・保存のいずれも呼ばれない", async () => {
    const fetchUser = vi.fn();
    const resolveOAuthCompanyId = vi.fn();
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "GET",
      authHeader: null,
      parseBody: vi.fn(),
      fetchUser,
      env: buildEnv(),
      resolveOAuthCompanyId,
      saveConcurUserLink,
    });

    expect(status).toBe(405);
    expect(body.error.code).toBe("method_not_allowed");
    expect(fetchUser).not.toHaveBeenCalled();
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });
});

describe("handleLinkConcurUserRequest（認証）", () => {
  it("未認証はunauthorized（401）。それ以降は一切呼ばれない", async () => {
    const resolveOAuthCompanyId = vi.fn();
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      authHeader: null,
      parseBody: buildParseBody(),
      fetchUser: vi.fn(),
      env: buildEnv(),
      resolveOAuthCompanyId,
      saveConcurUserLink,
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });
});

describe("handleLinkConcurUserRequest（安全ゲート）", () => {
  it("CONCUR_USER_LINK_ENABLEDが無効の場合、linked:falseかつparseBody・resolveOAuthCompanyId・Vault・Identity API・保存のいずれも呼ばない", async () => {
    const parseBody = vi.fn();
    const resolveOAuthCompanyId = vi.fn();
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId, saveConcurUserLink }),
      parseBody,
      env: buildEnv({ CONCUR_USER_LINK_ENABLED: undefined }),
    });

    expect(status).toBe(200);
    expect(body).toEqual({ result: { linked: false, status: "disabled" }, error: null });
    expect(parseBody).not.toHaveBeenCalled();
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });

  it("CONCUR_QUICK_EXPENSE_ENABLEDが\"true\"でも、このFunction専用のフラグが無ければ無効のまま", async () => {
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: { CONCUR_QUICK_EXPENSE_ENABLED: "true" },
    });

    expect(status).toBe(200);
    expect(body.result.status).toBe("disabled");
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });
});

describe("handleLinkConcurUserRequest（入力検証）", () => {
  it("JSONパース自体が失敗した場合はinvalid_json（400）", async () => {
    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: vi.fn().mockRejectedValue(new Error("bad json")),
      env: buildEnv(),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_json");
  });

  it("companyCodeが無い場合はconcur_user_link_invalid_request。resolveOAuthCompanyIdは呼ばれない", async () => {
    const resolveOAuthCompanyId = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      parseBody: buildParseBody({ concurLoginId: DUMMY_CONCUR_LOGIN_ID }),
      env: buildEnv(),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_user_link_invalid_request");
    expect(resolveOAuthCompanyId).not.toHaveBeenCalled();
  });

  it("concurLoginIdが無い場合はconcur_user_link_invalid_request", async () => {
    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: buildParseBody({ companyCode: DUMMY_COMPANY_CODE }),
      env: buildEnv(),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_user_link_invalid_request");
  });

  it("concurLoginIdが禁止文字を含む場合もconcur_user_link_invalid_request", async () => {
    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: buildParseBody({ companyCode: DUMMY_COMPANY_CODE, concurLoginId: "user%name" }),
      env: buildEnv(),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("concur_user_link_invalid_request");
  });

  it("入力検証で拒否された場合、入力値そのものをレスポンスへ反射しない", async () => {
    const secretLikeInput = "SHOULD_NOT_BE_REFLECTED_INPUT";
    const { body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: buildParseBody({ companyCode: DUMMY_COMPANY_CODE, concurLoginId: `${secretLikeInput}%` }),
      env: buildEnv(),
    });

    expect(JSON.stringify(body)).not.toContain(secretLikeInput);
  });
});

describe("handleLinkConcurUserRequest（会社境界：resolveOAuthCompanyId）", () => {
  it("resolveOAuthCompanyIdへ、検証済みuserIdと本文のcompanyCodeが渡る", async () => {
    const resolveOAuthCompanyId = vi.fn().mockResolvedValue(DUMMY_COMPANY_UUID);

    await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_CONCUR_USER_ID }),
    });

    expect(resolveOAuthCompanyId).toHaveBeenCalledWith({ userId: AUTHED_USER_ID, companyCode: DUMMY_COMPANY_CODE });
  });

  it("未所属・存在しない会社（resolveOAuthCompanyIdがnull）はforbidden（403）。Vault・Identity API・保存は呼ばれない", async () => {
    const resolveOAuthCompanyId = vi.fn().mockResolvedValue(null);
    const getRefreshTokenForEdge = vi.fn();
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId, saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge,
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(getRefreshTokenForEdge).not.toHaveBeenCalled();
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });

  it("空文字を返した場合も未解決として扱いforbidden", async () => {
    const resolveOAuthCompanyId = vi.fn().mockResolvedValue("");

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      parseBody: buildParseBody(),
      env: buildEnv(),
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("resolveOAuthCompanyId自体が例外を投げた場合はinternal_error", async () => {
    const resolveOAuthCompanyId = vi.fn().mockRejectedValue(new Error("db error"));

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ resolveOAuthCompanyId }),
      parseBody: buildParseBody(),
      env: buildEnv(),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
  });
});

describe("handleLinkConcurUserRequest（Vault・OAuth連携）", () => {
  it("getRefreshTokenForEdgeがnullを返す場合はconcur_oauth_not_connected。OAuth・Identity API・保存は呼ばれない", async () => {
    const refreshAccessToken = vi.fn();
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(null),
      refreshAccessToken,
    });

    expect(status).toBe(503);
    expect(body.error.code).toBe("concur_oauth_not_connected");
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });

  it("OAuth（refreshAccessToken）が失敗した場合、元のエラーコードを返しリースを解放する。Identity API・保存は呼ばれない", async () => {
    const completeOAuthRefresh = vi.fn().mockResolvedValue(true);
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "concur_oauth_rejected", message: "Concurの認証情報が拒否されました。" },
      }),
      completeOAuthRefresh,
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
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });

  it("completeOAuthRefreshが例外を投げた場合はconcur_oauth_storage_failed。Identity API・保存は呼ばれない", async () => {
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockRejectedValue(new Error("db error")),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_oauth_storage_failed");
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });

  it("completeOAuthRefreshがfalseを返す場合（lease不一致）はconcur_oauth_completion_failed。保存は呼ばれない", async () => {
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(false),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_oauth_completion_failed");
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });
});

describe("handleLinkConcurUserRequest（Identity API連携・保存）", () => {
  it("保存成功後、lookupUserへgeolocation・accessToken・concurLoginIdを渡す", async () => {
    const lookupUser = vi.fn().mockResolvedValue({ ok: true, userId: VALID_CONCUR_USER_ID });

    await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser,
    });

    expect(lookupUser).toHaveBeenCalledWith(
      expect.objectContaining({
        geolocation: DUMMY_GEOLOCATION,
        accessToken: DUMMY_ACCESS_TOKEN,
        userName: DUMMY_CONCUR_LOGIN_ID,
      }),
    );
  });

  it("0件（concur_user_not_found）は保存せずそのままエラーコードを返す", async () => {
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
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
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });

  it("複数件（concur_user_ambiguous）も保存せずそのままエラーコードを返す", async () => {
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
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
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });

  it("1件ヒット（成功）した場合、saveConcurUserLinkへuserId・companyId・concurLoginIdを渡し、linked:trueを返す", async () => {
    const saveConcurUserLink = vi.fn().mockResolvedValue(undefined);

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_CONCUR_USER_ID }),
    });

    expect(saveConcurUserLink).toHaveBeenCalledWith({
      userId: AUTHED_USER_ID,
      companyId: DUMMY_COMPANY_UUID,
      concurLoginId: DUMMY_CONCUR_LOGIN_ID,
    });
    expect(status).toBe(200);
    expect(body).toEqual({ result: { linked: true }, error: null });
  });

  it("保存(saveConcurUserLink)が例外を投げた場合はconcur_user_link_save_failed", async () => {
    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink: vi.fn().mockRejectedValue(new Error("db error")) }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_CONCUR_USER_ID }),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("concur_user_link_save_failed");
  });

  it("lookupUserが例外を投げた場合はinternal_error。保存は呼ばれない", async () => {
    const saveConcurUserLink = vi.fn();

    const { status, body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput({ saveConcurUserLink }),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockRejectedValue(new Error("boom")),
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(saveConcurUserLink).not.toHaveBeenCalled();
  });
});

describe("handleLinkConcurUserRequest（セキュリティ・非露出）", () => {
  it("Access Token・Refresh Token・Concur User ID（UUID）・concurLoginIdがレスポンスへ一切含まれない（成功時）", async () => {
    const { body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(
        buildSuccessfulOAuthResult({ rotated: true, tokens: { accessToken: DUMMY_ACCESS_TOKEN, refreshToken: DUMMY_NEW_REFRESH_TOKEN, geolocation: DUMMY_GEOLOCATION } }),
      ),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_CONCUR_USER_ID }),
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(serialized).not.toContain(DUMMY_REFRESH_TOKEN);
    expect(serialized).not.toContain(DUMMY_NEW_REFRESH_TOKEN);
    expect(serialized).not.toContain(VALID_CONCUR_USER_ID);
    expect(serialized).not.toContain(DUMMY_CONCUR_LOGIN_ID);
  });

  it("成功レスポンスはlinkedフィールドのみを持つ（余分な情報を含まない）", async () => {
    const { body } = await handleLinkConcurUserRequest({
      method: "POST",
      ...buildAuthedInput(),
      parseBody: buildParseBody(),
      env: buildEnv(),
      getRefreshTokenForEdge: vi.fn().mockResolvedValue(buildLease()),
      refreshAccessToken: vi.fn().mockResolvedValue(buildSuccessfulOAuthResult()),
      completeOAuthRefresh: vi.fn().mockResolvedValue(true),
      lookupUser: vi.fn().mockResolvedValue({ ok: true, userId: VALID_CONCUR_USER_ID }),
    });

    expect(Object.keys(body.result)).toEqual(["linked"]);
  });
});
