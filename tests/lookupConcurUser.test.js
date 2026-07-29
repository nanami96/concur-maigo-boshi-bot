import { describe, it, expect } from "vitest";
import { lookupConcurUser } from "../supabase/functions/_shared/concur-identity/lookupConcurUser.js";

// 以下の値はすべてテスト専用のダミー値であり、実際のConcur側の値ではない。
// 本物のIdentity APIへは一切通信しない（fetchImplを常にモックへ差し替える）。
const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const DUMMY_USER_NAME = "user@example.com";
const VALID_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";

function jsonFetch(status, body, headersMap = {}) {
  return async () => ({
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (name) => (Object.prototype.hasOwnProperty.call(headersMap, name) ? headersMap[name] : null) },
  });
}

function listResponse(resources) {
  return { schemas: [], totalResults: resources.length, startIndex: 1, itemsPerPage: resources.length, Resources: resources };
}

describe("lookupConcurUser（成功系）", () => {
  it("1件ヒットした場合、userIdを返す", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(200, listResponse([{ id: VALID_USER_ID }])),
    });

    expect(result.ok).toBe(true);
    expect(result.userId).toBe(VALID_USER_ID);
  });
});

describe("lookupConcurUser（検索結果の異常系）", () => {
  it("0件はconcur_user_not_found", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(200, listResponse([])),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_user_not_found");
  });

  it("複数件はconcur_user_ambiguous", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(200, listResponse([{ id: VALID_USER_ID }, { id: "another-uuid" }])),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_user_ambiguous");
  });

  it("userID欠落はconcur_identity_invalid_response", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(200, listResponse([{ userName: DUMMY_USER_NAME }])),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_invalid_response");
  });

  it("resources配列不正はconcur_identity_invalid_response", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(200, { Resources: "not-an-array" }),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_invalid_response");
  });

  it("JSON不正（response.json()が例外）はconcur_identity_invalid_response", async () => {
    const fetchImpl = async () => ({
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    });

    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_invalid_response");
  });
});

describe("lookupConcurUser（HTTP異常系）", () => {
  it("タイムアウトした場合はconcur_identity_timeout", async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_timeout");
  });

  it("通常のネットワークエラーはconcur_identity_network_error", async () => {
    const fetchImpl = async () => {
      throw new Error("dummy connection refused");
    };

    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_network_error");
  });

  it("401はconcur_identity_rejected", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, {}),
    });
    expect(result.error.code).toBe("concur_identity_rejected");
  });

  it("403はconcur_identity_rejected", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(403, {}),
    });
    expect(result.error.code).toBe("concur_identity_rejected");
  });

  it("429はconcur_identity_rate_limited", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(429, {}),
    });
    expect(result.error.code).toBe("concur_identity_rate_limited");
  });

  it("500はconcur_identity_service_error", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(500, {}),
    });
    expect(result.error.code).toBe("concur_identity_service_error");
  });
});

// 【一時的なデバッグログ・要削除】concur_identity_rejected（401/403）発生時
// だけ、Concurのレスポンス本文からerror・error_descriptionの2フィールドだけを
// 安全に抽出した構造化オブジェクトをlog()へ渡す挙動のテスト。生レスポンス本文
// 全体は一切ログへ出さない。
describe("lookupConcurUser（一時デバッグログ：concur_identity_rejectedのみ・error/error_descriptionのみ）", () => {
  it("401の場合、logへstatus・error・error_descriptionを構造化オブジェクトで渡す", async () => {
    const calls = [];

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, { error: "invalid_token", error_description: "The access token expired" }),
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls.length).toBe(1);
    expect(calls[0].details).toEqual({
      stage: "identity_rejected",
      status: 401,
      error: "invalid_token",
      errorDescription: "The access token expired",
      responseJsonParsed: true,
      requestIdPresent: false,
      requestId: null,
    });
  });

  it("403の場合も同様に構造化オブジェクトで渡す", async () => {
    const calls = [];

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(403, { error: "insufficient_scope" }),
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls.length).toBe(1);
    expect(calls[0].details.status).toBe(403);
    expect(calls[0].details.error).toBe("insufficient_scope");
    expect(calls[0].details.errorDescription).toBeNull();
  });

  it("JSONでない本文の場合はresponseJsonParsed:false・error/errorDescription:nullだけを渡し、本文自体は含まない", async () => {
    const calls = [];
    const fetchImpl = async () => ({
      status: 401,
      json: async () => { throw new Error("not json"); },
      text: async () => "<html>SECRET_INTERNAL_HTML_BODY</html>",
      headers: { get: () => null },
    });

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls.length).toBe(1);
    expect(calls[0].details.responseJsonParsed).toBe(false);
    expect(calls[0].details.error).toBeNull();
    expect(calls[0].details.errorDescription).toBeNull();
    expect(JSON.stringify(calls[0])).not.toContain("SECRET_INTERNAL_HTML_BODY");
  });

  it("request ID系ヘッダーが存在する場合、requestIdPresentとrequestIdを渡す", async () => {
    const calls = [];

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, { error: "invalid_token" }, { "x-request-id": "req-123" }),
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls[0].details.requestIdPresent).toBe(true);
    expect(calls[0].details.requestId).toBe("req-123");
  });

  it("message・userName・メールアドレス・userIDをログへ含めない（error_description内に埋め込まれていてもredactされる）", async () => {
    const calls = [];
    const rejectionBody = {
      error: "invalid_token",
      error_description: "token expired for taro.yamada@example.com (id 3df11695-e8bb-40ff-8e98-c85913ab2789)",
      message: "full message body should not leak",
      userName: DUMMY_USER_NAME,
    };

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, rejectionBody),
      log: (message, details) => calls.push({ message, details }),
    });

    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("taro.yamada@example.com");
    expect(serialized).not.toContain("full message body should not leak");
    expect(serialized).not.toContain(DUMMY_USER_NAME);
    expect(serialized).not.toContain("3df11695-e8bb-40ff-8e98-c85913ab2789");
    expect(calls[0].details.error).toBe("invalid_token");
    expect(calls[0].details.errorDescription).toBe("token expired for [redacted-email] (id [redacted-id])");
  });

  it("不正な型のerror候補はnullになる", async () => {
    const calls = [];

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, { error: { nested: "object" } }),
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls[0].details.error).toBeNull();
  });

  it("長すぎるerror候補はnullになる", async () => {
    const calls = [];

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, { error: "x".repeat(200) }),
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls[0].details.error).toBeNull();
  });

  it("制御文字を含むerror候補は安全化される（改行等を除去）", async () => {
    const calls = [];

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, { error: "invalid\ntoken" }),
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls[0].details.error).not.toContain("\n");
  });

  it("Access Token・Refresh Token・Client Secretらしい長い文字列がerror_descriptionに埋め込まれていてもredactされる", async () => {
    const calls = [];
    const DUMMY_REFRESH_TOKEN_LIKE = "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK_VALUE";

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, { error: "invalid_token", error_description: `refresh token ${DUMMY_REFRESH_TOKEN_LIKE} was rejected` }),
      log: (message, details) => calls.push({ message, details }),
    });

    expect(calls[0].details.errorDescription).not.toContain(DUMMY_REFRESH_TOKEN_LIKE);
    expect(calls[0].details.errorDescription).toContain("[redacted-token]");
  });

  it("concur_identity_rejected以外（429・500・timeout・network等）ではこの一時ログを呼ばない", async () => {
    const calls = [];
    const logFn = (message, details) => calls.push({ message, details });

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(429, {}),
      log: logFn,
    });
    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(500, {}),
      log: logFn,
    });
    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(200, listResponse([{ id: VALID_USER_ID }])),
      log: logFn,
    });

    expect(calls.length).toBe(0);
  });

  it("logを渡さない場合も例外にならない（既定の呼び出しとの後方互換）", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, {}),
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_rejected");
  });

  it("レスポンス本文が読み取れない場合（text()が例外）でも処理は継続し、安全にconcur_identity_rejectedを返す", async () => {
    const calls = [];
    const fetchImpl = async () => ({
      status: 401,
      json: async () => { throw new Error("not json"); },
      text: async () => { throw new Error("body already consumed"); },
      headers: { get: () => null },
    });

    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
      log: (message, details) => calls.push({ message, details }),
    });

    expect(result.error.code).toBe("concur_identity_rejected");
    expect(calls.length).toBe(1);
    expect(calls[0].details.status).toBe(401);
    expect(calls[0].details.responseJsonParsed).toBe(false);
    expect(calls[0].details.error).toBeNull();
    expect(calls[0].details.errorDescription).toBeNull();
  });

  it("logへ渡される内容にAccess Token・Refresh Token・Client Secretの値が一切含まれない", async () => {
    const calls = [];
    const DUMMY_REFRESH_TOKEN = "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK";
    const DUMMY_CLIENT_SECRET = "DUMMY_CLIENT_SECRET_SHOULD_NOT_LEAK";

    await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(401, { error: "invalid_token" }),
      log: (message, details) => calls.push({ message, details }),
    });

    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(serialized).not.toContain(DUMMY_REFRESH_TOKEN);
    expect(serialized).not.toContain(DUMMY_CLIENT_SECRET);
  });
});

describe("lookupConcurUser（geolocation欠落）", () => {
  it("geolocationが無い場合はIdentity APIへ一切通信せずconcur_identity_geolocation_missing", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => listResponse([{ id: VALID_USER_ID }]) };
    };

    const result = await lookupConcurUser({
      geolocation: null,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_geolocation_missing");
    expect(fetchCalled).toBe(false);
  });

  it("geolocationが空白のみの場合も同様に通信しない", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return { status: 200, json: async () => listResponse([]) };
    };

    const result = await lookupConcurUser({
      geolocation: "   ",
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("concur_identity_geolocation_missing");
    expect(fetchCalled).toBe(false);
  });
});

describe("lookupConcurUser（セキュリティ・非露出）", () => {
  it("Access Token・userNameの値がエラー結果へ一切含まれない", async () => {
    const fetchImpl = jsonFetch(500, { debug: "RAW_RESPONSE_BODY_SHOULD_NOT_LEAK" });

    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(serialized).not.toContain(DUMMY_USER_NAME);
    expect(serialized).not.toContain("RAW_RESPONSE_BODY_SHOULD_NOT_LEAK");
  });

  it("fetch例外の詳細（メッセージ）を外部へ一切漏らさない", async () => {
    const secretLikeMessage = "SHOULD_NOT_LEAK_EXCEPTION_DETAIL";
    const fetchImpl = async () => {
      throw new Error(secretLikeMessage);
    };

    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl,
    });

    expect(JSON.stringify(result)).not.toContain(secretLikeMessage);
  });

  it("成功結果にAccess Token・利用者プロフィール（userName等）が含まれない（userIdのみ）", async () => {
    const result = await lookupConcurUser({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userName: DUMMY_USER_NAME,
      fetchImpl: jsonFetch(200, listResponse([{ id: VALID_USER_ID, userName: DUMMY_USER_NAME, displayName: "Should Not Leak" }])),
    });

    expect(Object.keys(result).sort()).toEqual(["ok", "userId"].sort());
    expect(JSON.stringify(result)).not.toContain("Should Not Leak");
    expect(JSON.stringify(result)).not.toContain(DUMMY_ACCESS_TOKEN);
  });
});
