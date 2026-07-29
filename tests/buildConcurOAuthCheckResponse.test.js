import { describe, it, expect } from "vitest";
import { buildConcurOAuthCheckResponse } from "../supabase/functions/check-concur-oauth/buildConcurOAuthCheckResponse.js";

// 以下のトークン値はすべてテスト専用のダミー値であり、実際のConcur側の
// トークンではない。

describe("buildConcurOAuthCheckResponse（成功系）", () => {
  it("rotated:falseの場合、connected:true・hasGeolocation・expiresInPresent・refreshTokenRotated:falseを返す", () => {
    const response = buildConcurOAuthCheckResponse({
      ok: true,
      rotated: false,
      tokens: { accessToken: "dummy-access-token" },
      logSummary: { ok: true, rotated: false, hasAccessToken: true, hasGeolocation: true, hasScope: false, expiresInPresent: true },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: { connected: true, hasGeolocation: true, expiresInPresent: true, refreshTokenRotated: false },
      error: null,
    });
  });

  it("戻り値に実際のトークン値・geolocationの実URL・scopeの生値を一切含めない", () => {
    const response = buildConcurOAuthCheckResponse({
      ok: true,
      rotated: false,
      tokens: {
        accessToken: "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK",
        refreshToken: "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK",
        geolocation: "https://dummy-geolocation-should-not-leak.example.test",
        scope: "DUMMY_SCOPE_SHOULD_NOT_LEAK",
      },
      logSummary: { ok: true, rotated: false, hasAccessToken: true, hasGeolocation: true, hasScope: true, expiresInPresent: true },
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("dummy-geolocation-should-not-leak");
    expect(serialized).not.toContain("DUMMY_SCOPE_SHOULD_NOT_LEAK");
  });
});

describe("buildConcurOAuthCheckResponse（Refresh Tokenローテーション）", () => {
  it("rotated:trueの場合は成功として扱わず、concur_oauth_rotation_unsupportedを返す（409）", () => {
    const response = buildConcurOAuthCheckResponse({
      ok: true,
      rotated: true,
      tokens: { accessToken: "dummy-access-token", refreshToken: "dummy-new-refresh-token" },
      logSummary: { ok: true, rotated: true, hasAccessToken: true, hasGeolocation: true, hasScope: false, expiresInPresent: true },
    });

    expect(response.status).toBe(409);
    expect(response.body.result).toBeNull();
    expect(response.body.error.code).toBe("concur_oauth_rotation_unsupported");
  });

  it("ローテーション時のエラー本文にも新しいrefresh_tokenの値を含めない", () => {
    const response = buildConcurOAuthCheckResponse({
      ok: true,
      rotated: true,
      tokens: { accessToken: "dummy-access-token", refreshToken: "DUMMY_NEW_REFRESH_TOKEN_SHOULD_NOT_LEAK" },
      logSummary: { ok: true, rotated: true, hasAccessToken: true, hasGeolocation: false, hasScope: false, expiresInPresent: true },
    });

    expect(JSON.stringify(response)).not.toContain("DUMMY_NEW_REFRESH_TOKEN_SHOULD_NOT_LEAK");
  });
});

describe("buildConcurOAuthCheckResponse（エラー系）", () => {
  it.each([
    ["concur_not_configured", 500],
    ["concur_oauth_timeout", 504],
    ["concur_oauth_network_error", 502],
    ["concur_oauth_rejected", 502],
    ["concur_oauth_rate_limited", 429],
    ["concur_oauth_service_error", 502],
    ["concur_oauth_invalid_response", 502],
  ])("%sは%iへ変換される", (code, expectedStatus) => {
    const response = buildConcurOAuthCheckResponse({ ok: false, error: { code, message: "固定メッセージ" } });

    expect(response.status).toBe(expectedStatus);
    expect(response.body).toEqual({ result: null, error: { code, message: "固定メッセージ" } });
  });

  it("未知のエラーコードでも例外にならず500へフォールバックする", () => {
    const response = buildConcurOAuthCheckResponse({ ok: false, error: { code: "unknown_code", message: "固定メッセージ" } });

    expect(response.status).toBe(500);
  });
});
