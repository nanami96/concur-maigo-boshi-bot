import { describe, it, expect } from "vitest";
import { refreshConcurAccessToken } from "../supabase/functions/_shared/concur-oauth/refreshConcurAccessToken.js";

// 以下の認証情報・トークン値はすべてテスト専用のダミー値であり、
// 実際のConcur側の値ではない。本物のtoken endpointへは一切通信しない
// （fetchImplを常にモックへ差し替える）。

const DUMMY_CLIENT_SECRET = "DUMMY_CLIENT_SECRET_SHOULD_NOT_LEAK";
const DUMMY_CURRENT_REFRESH_TOKEN = "DUMMY_CURRENT_REFRESH_TOKEN_SHOULD_NOT_LEAK";

// CONCUR_REFRESH_TOKENはSecretsに含めない（Refresh TokenはVault RPC経由で
// 取得し、refreshConcurAccessToken()へ明示的な引数として渡す設計のため。
// resolveConcurOAuthConfig.test.jsも参照）。
function buildEnv(overrides = {}) {
  return {
    CONCUR_CLIENT_ID: "dummy-client-id",
    CONCUR_CLIENT_SECRET: DUMMY_CLIENT_SECRET,
    CONCUR_TOKEN_URL: "https://example-dummy.concursolutions.test/oauth2/v0/token",
    ...overrides,
  };
}

function jsonFetch(status, body) {
  return async () => ({
    status,
    json: async () => body,
  });
}

describe("refreshConcurAccessToken（設定不足）", () => {
  it("必須Secretsが不足している場合はconcur_not_configuredで失敗し、fetchは一切呼ばれない", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => ({}) };
    };

    const result = await refreshConcurAccessToken({ env: {}, refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_not_configured");
    expect(fetchCalled).toBe(false);
  });

  it("CONCUR_TOKEN_URLがhttp（非暗号化）の場合もconcur_not_configuredで失敗し、fetchは呼ばれない", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => ({}) };
    };

    const result = await refreshConcurAccessToken({
      env: buildEnv({ CONCUR_TOKEN_URL: "http://example-dummy.concursolutions.test/oauth2/v0/token" }),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_not_configured");
    expect(fetchCalled).toBe(false);
  });

  it("refreshTokenが指定されていない場合はconcur_not_configuredで失敗し、fetchは呼ばれない", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => ({}) };
    };

    const result = await refreshConcurAccessToken({ env: buildEnv(), fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_not_configured");
    expect(fetchCalled).toBe(false);
  });

  it("refreshTokenが空文字・空白のみの場合もconcur_not_configuredで失敗する", async () => {
    const fetchImpl = async () => ({ status: 200, json: async () => ({}) });

    const empty = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: "", fetchImpl });
    const blank = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: "   ", fetchImpl });

    expect(empty.error.code).toBe("concur_not_configured");
    expect(blank.error.code).toBe("concur_not_configured");
  });
});

describe("refreshConcurAccessToken（成功系）", () => {
  it("access_token・expires_in・geolocationが揃った正常応答", async () => {
    const fetchImpl = jsonFetch(200, {
      access_token: "dummy-access-token",
      expires_in: 3600,
      geolocation: "https://example-dummy.concursolutions.test",
      token_type: "Bearer",
    });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.tokens.accessToken).toBe("dummy-access-token");
    expect(result.logSummary).toMatchObject({
      ok: true,
      hasAccessToken: true,
      hasGeolocation: true,
      expiresInPresent: true,
    });
  });

  it("新しいrefresh_tokenが返った場合はrotated: true", async () => {
    const fetchImpl = jsonFetch(200, {
      access_token: "dummy-access-token",
      refresh_token: "DUMMY_NEW_REFRESH_TOKEN",
    });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.rotated).toBe(true);
    expect(result.logSummary.rotated).toBe(true);
  });

  it("refresh_tokenが返らない場合はrotated: false", async () => {
    const fetchImpl = jsonFetch(200, { access_token: "dummy-access-token" });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.rotated).toBe(false);
  });

  it("返されたrefresh_tokenが今回使ったrefreshToken引数と同じ場合はrotated: false", async () => {
    const fetchImpl = jsonFetch(200, {
      access_token: "dummy-access-token",
      refresh_token: DUMMY_CURRENT_REFRESH_TOKEN,
    });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.rotated).toBe(false);
  });

  it("scopeが返る場合・返らない場合の両方が正常に扱われる", async () => {
    const withScope = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(200, { access_token: "dummy-access-token", scope: "dummy.scope" }),
    });
    const withoutScope = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(200, { access_token: "dummy-access-token" }),
    });

    expect(withScope.ok).toBe(true);
    expect(withScope.logSummary.hasScope).toBe(true);
    expect(withoutScope.ok).toBe(true);
    expect(withoutScope.logSummary.hasScope).toBe(false);
  });

  it("logSummaryに実際のトークン値・client_secret・refresh_tokenの値が一切含まれない", async () => {
    const fetchImpl = jsonFetch(200, {
      access_token: "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK",
      refresh_token: "DUMMY_NEW_REFRESH_TOKEN_SHOULD_NOT_LEAK",
      geolocation: "DUMMY_GEOLOCATION_SHOULD_NOT_LEAK",
      scope: "DUMMY_SCOPE_SHOULD_NOT_LEAK",
    });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    const serializedSummary = JSON.stringify(result.logSummary);
    expect(serializedSummary).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
    expect(serializedSummary).not.toContain("DUMMY_NEW_REFRESH_TOKEN_SHOULD_NOT_LEAK");
    expect(serializedSummary).not.toContain("DUMMY_GEOLOCATION_SHOULD_NOT_LEAK");
    expect(serializedSummary).not.toContain("DUMMY_SCOPE_SHOULD_NOT_LEAK");
    expect(serializedSummary).not.toContain(DUMMY_CLIENT_SECRET);
    expect(serializedSummary).not.toContain(DUMMY_CURRENT_REFRESH_TOKEN);
  });
});

describe("refreshConcurAccessToken（異常系）", () => {
  it("タイムアウトした場合はconcur_oauth_timeout", async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_oauth_timeout");
  });

  it("通常のネットワークエラーはconcur_oauth_network_error", async () => {
    const fetchImpl = async () => {
      throw new Error("dummy connection refused");
    };

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_oauth_network_error");
  });

  it("400はconcur_oauth_rejected", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(400, {}),
    });
    expect(result.error.code).toBe("concur_oauth_rejected");
  });

  it("401はconcur_oauth_rejected", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(401, {}),
    });
    expect(result.error.code).toBe("concur_oauth_rejected");
  });

  it("429はconcur_oauth_rate_limited", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(429, {}),
    });
    expect(result.error.code).toBe("concur_oauth_rate_limited");
  });

  it("500はconcur_oauth_service_error", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(500, {}),
    });
    expect(result.error.code).toBe("concur_oauth_service_error");
  });

  it("403はconcur_oauth_rejected（invalid_responseとは区別しない）", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(403, {}),
    });
    expect(result.error.code).toBe("concur_oauth_rejected");
  });

  it("expires_inが0の場合はconcur_oauth_invalid_response（有効期限として無意味なため拒否）", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(200, { access_token: "dummy-access-token", expires_in: 0 }),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_oauth_invalid_response");
  });

  it("JSONでないレスポンス（response.json()が例外を投げる）はconcur_oauth_invalid_response", async () => {
    const fetchImpl = async () => ({
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_oauth_invalid_response");
  });

  it("2xxだがaccess_tokenが無い場合はconcur_oauth_invalid_response", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(200, { expires_in: 3600 }),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_oauth_invalid_response");
  });

  it("access_tokenの型が不正（数値等）な場合はconcur_oauth_invalid_response", async () => {
    const result = await refreshConcurAccessToken({
      env: buildEnv(),
      refreshToken: DUMMY_CURRENT_REFRESH_TOKEN,
      fetchImpl: jsonFetch(200, { access_token: 12345 }),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_oauth_invalid_response");
  });

  it("fetch例外の詳細（メッセージ）を外部（error/logSummary）へ一切漏らさない", async () => {
    const secretLikeMessage = "SHOULD_NOT_LEAK_EXCEPTION_DETAIL";
    const fetchImpl = async () => {
      throw new Error(secretLikeMessage);
    };

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(JSON.stringify(result)).not.toContain(secretLikeMessage);
  });
});

describe("refreshConcurAccessToken（セキュリティ）", () => {
  it("エラー本文にclient_secret・access_token・refresh_tokenの値を一切含めない", async () => {
    const fetchImpl = jsonFetch(401, {
      error: "invalid_client",
      error_description: `client_secret ${DUMMY_CLIENT_SECRET} was rejected`,
    });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(DUMMY_CLIENT_SECRET);
    expect(serialized).not.toContain(DUMMY_CURRENT_REFRESH_TOKEN);
    // OAuthサーバーのerror_description（生の文言）自体も転記しない。
    expect(serialized).not.toContain("invalid_client");
    expect(serialized).not.toContain("was rejected");
  });

  it("生のレスポンス本文（access_token以外のフィールドを含む生JSON）をエラーへ含めない", async () => {
    const rawBodyMarker = "RAW_RESPONSE_BODY_SHOULD_NOT_LEAK";
    const fetchImpl = jsonFetch(500, { debug: rawBodyMarker });

    const result = await refreshConcurAccessToken({ env: buildEnv(), refreshToken: DUMMY_CURRENT_REFRESH_TOKEN, fetchImpl });

    expect(JSON.stringify(result)).not.toContain(rawBodyMarker);
  });
});
