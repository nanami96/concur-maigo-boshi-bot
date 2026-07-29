import { describe, it, expect } from "vitest";
import { lookupConcurUser } from "../supabase/functions/_shared/concur-identity/lookupConcurUser.js";

// 以下の値はすべてテスト専用のダミー値であり、実際のConcur側の値ではない。
// 本物のIdentity APIへは一切通信しない（fetchImplを常にモックへ差し替える）。
const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const DUMMY_USER_NAME = "user@example.com";
const VALID_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";

function jsonFetch(status, body) {
  return async () => ({ status, json: async () => body });
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
