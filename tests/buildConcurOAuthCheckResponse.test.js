import { describe, it, expect } from "vitest";
import {
  buildConcurOAuthCheckError,
  classifyConcurOAuthCheckHttpStatus,
  buildConcurOAuthCheckSuccessResponse,
  buildConcurOAuthCheckErrorResponse,
} from "../supabase/functions/check-concur-oauth/buildConcurOAuthCheckResponse.js";

describe("buildConcurOAuthCheckSuccessResponse", () => {
  it("connected:true・hasGeolocation・expiresInPresent・refreshTokenRotated・scope系真偽値を返す（200）", () => {
    const response = buildConcurOAuthCheckSuccessResponse({
      hasGeolocation: true,
      expiresInPresent: true,
      rotated: false,
      scopePresent: true,
      hasQuickExpenseWriteScope: true,
      hasUserReadScope: true,
      hasIdentityUserIdsReadScope: true,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: {
        connected: true,
        hasGeolocation: true,
        expiresInPresent: true,
        refreshTokenRotated: false,
        scopePresent: true,
        hasQuickExpenseWriteScope: true,
        hasUserReadScope: true,
        hasIdentityUserIdsReadScope: true,
      },
      error: null,
    });
  });

  it("rotated:trueの場合はrefreshTokenRotated:trueを返す（Vault保存成功後に呼ばれる想定）", () => {
    const response = buildConcurOAuthCheckSuccessResponse({
      hasGeolocation: false,
      expiresInPresent: false,
      rotated: true,
    });

    expect(response.body.result.refreshTokenRotated).toBe(true);
  });

  it("boolean以外の値が渡されても真偽値へ丸められる", () => {
    const response = buildConcurOAuthCheckSuccessResponse({});

    expect(response.body.result).toEqual({
      connected: true,
      hasGeolocation: false,
      expiresInPresent: false,
      refreshTokenRotated: false,
      scopePresent: false,
      hasQuickExpenseWriteScope: false,
      hasUserReadScope: false,
      hasIdentityUserIdsReadScope: false,
    });
  });

  it("戻り値に実際のトークン値・geolocationの実URL・scope文字列を一切含めない", () => {
    // このビルダーはtokens・scope文字列自体を受け取らない設計のため、
    // 呼び出し元が真偽値だけを渡す限り、戻り値にトークン値・scope生値が
    // 混入する余地が無いことを明示的に確認する。
    const response = buildConcurOAuthCheckSuccessResponse({
      hasGeolocation: true,
      expiresInPresent: true,
      rotated: true,
      scopePresent: true,
      hasQuickExpenseWriteScope: true,
      hasUserReadScope: true,
      hasIdentityUserIdsReadScope: true,
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toMatch(/access_token|refresh_token|geolocation.*:.*http/i);
    expect(serialized).not.toContain("quickexpense.writeonly");
    expect(serialized).not.toContain("user.read");
    expect(serialized).not.toContain("identity.user.ids.read");
  });
});

describe("buildConcurOAuthCheckError / classifyConcurOAuthCheckHttpStatus", () => {
  it.each([
    ["concur_not_configured", 500],
    ["concur_oauth_timeout", 504],
    ["concur_oauth_network_error", 502],
    ["concur_oauth_rejected", 502],
    ["concur_oauth_rate_limited", 429],
    ["concur_oauth_service_error", 502],
    ["concur_oauth_invalid_response", 502],
    ["concur_oauth_not_connected", 503],
    ["concur_oauth_completion_failed", 500],
    ["concur_oauth_storage_failed", 500],
    ["internal_error", 500],
  ])("%sは%iへ変換される", (code, expectedStatus) => {
    expect(classifyConcurOAuthCheckHttpStatus(code)).toBe(expectedStatus);
  });

  it("未知のコードでも例外にならず500へフォールバックする", () => {
    expect(classifyConcurOAuthCheckHttpStatus("unknown_code")).toBe(500);
  });

  it.each(["concur_oauth_not_connected", "concur_oauth_completion_failed", "concur_oauth_storage_failed", "internal_error"])(
    "%sは固定メッセージを持つ",
    (code) => {
      const error = buildConcurOAuthCheckError(code);
      expect(error.code).toBe(code);
      expect(typeof error.message).toBe("string");
      expect(error.message.length).toBeGreaterThan(0);
    },
  );

  it("concur_oauth_not_connectedとconcur_oauth_completion_failedは別々の固定メッセージを持つ（区別可能）", () => {
    const notConnected = buildConcurOAuthCheckError("concur_oauth_not_connected");
    const completionFailed = buildConcurOAuthCheckError("concur_oauth_completion_failed");

    expect(notConnected.message).not.toBe(completionFailed.message);
  });
});

describe("buildConcurOAuthCheckErrorResponse", () => {
  it("エラーコードに応じたHTTPステータスとエラー本文を組み立てる", () => {
    const response = buildConcurOAuthCheckErrorResponse({ code: "concur_oauth_rate_limited", message: "固定メッセージ" });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ result: null, error: { code: "concur_oauth_rate_limited", message: "固定メッセージ" } });
  });

  it("resultは常にnull（成功結果と混ざらない）", () => {
    const response = buildConcurOAuthCheckErrorResponse({ code: "concur_oauth_storage_failed", message: "固定メッセージ" });

    expect(response.body.result).toBeNull();
  });

  it("エラー本文に生のOAuthレスポンス相当の情報が含まれない（渡されたmessageをそのまま使うだけ）", () => {
    const rawDetail = "invalid_grant: refresh token is expired (SHOULD_NOT_LEAK)";
    const response = buildConcurOAuthCheckErrorResponse({ code: "concur_oauth_rejected", message: "固定メッセージ" });

    expect(JSON.stringify(response)).not.toContain(rawDetail);
  });
});
