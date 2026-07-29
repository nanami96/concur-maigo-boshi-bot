import { describe, it, expect } from "vitest";
import { buildConcurRefreshTokenRequest } from "../supabase/functions/_shared/concur-oauth/buildConcurRefreshTokenRequest.js";

// 以下の値はすべてテスト専用のダミー値であり、実際のConcur側の
// 認証情報ではない。

function buildConfig(overrides = {}) {
  return {
    clientId: "dummy-client-id",
    clientSecret: "dummy-client-secret",
    refreshToken: "dummy-refresh-token",
    tokenUrl: "https://example-dummy.concursolutions.test/oauth2/v0/token",
    ...overrides,
  };
}

describe("buildConcurRefreshTokenRequest", () => {
  it("token endpointのURL・POSTメソッド・Content-Typeを正しく組み立てる", () => {
    const request = buildConcurRefreshTokenRequest(buildConfig());

    expect(request.url).toBe("https://example-dummy.concursolutions.test/oauth2/v0/token");
    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("bodyはapplication/x-www-form-urlencoded形式の文字列であり、JSONではない", () => {
    const request = buildConcurRefreshTokenRequest(buildConfig());

    expect(typeof request.body).toBe("string");
    expect(() => JSON.parse(request.body)).toThrow();
    expect(request.body.startsWith("{")).toBe(false);
  });

  it("grant_type=refresh_tokenと4つの必須項目が全て含まれる", () => {
    const request = buildConcurRefreshTokenRequest(buildConfig());
    const params = new URLSearchParams(request.body);

    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("client_id")).toBe("dummy-client-id");
    expect(params.get("client_secret")).toBe("dummy-client-secret");
    expect(params.get("refresh_token")).toBe("dummy-refresh-token");
  });

  it("scopeが設定されている場合だけbodyに含まれる", () => {
    const withScope = buildConcurRefreshTokenRequest(buildConfig({ scope: "dummy.scope" }));
    const withoutScope = buildConcurRefreshTokenRequest(buildConfig());

    expect(new URLSearchParams(withScope.body).get("scope")).toBe("dummy.scope");
    expect(new URLSearchParams(withoutScope.body).has("scope")).toBe(false);
  });

  it("scopeが空文字の場合はbodyに含めない", () => {
    const request = buildConcurRefreshTokenRequest(buildConfig({ scope: "" }));

    expect(new URLSearchParams(request.body).has("scope")).toBe(false);
  });
});
