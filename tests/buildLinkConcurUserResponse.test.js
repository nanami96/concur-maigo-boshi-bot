import { describe, it, expect } from "vitest";
import {
  buildLinkConcurUserError,
  classifyLinkConcurUserHttpStatus,
  buildLinkConcurUserSuccessResponse,
  buildLinkConcurUserErrorResponse,
} from "../supabase/functions/link-concur-user/buildLinkConcurUserResponse.js";

describe("buildLinkConcurUserSuccessResponse", () => {
  it("linked:trueを返す（200）", () => {
    const response = buildLinkConcurUserSuccessResponse({ linked: true });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ result: { linked: true }, error: null });
  });

  it("boolean以外の値が渡されても真偽値へ丸められる", () => {
    const response = buildLinkConcurUserSuccessResponse({});
    expect(response.body.result).toEqual({ linked: false });
  });

  it("戻り値にConcurログインID・Concur User ID相当の文字列値を一切含めない", () => {
    const response = buildLinkConcurUserSuccessResponse({ linked: true });
    expect(Object.keys(response.body.result)).toEqual(["linked"]);
  });
});

describe("buildLinkConcurUserError / classifyLinkConcurUserHttpStatus", () => {
  it.each([
    ["concur_user_link_invalid_request", 400],
    ["forbidden", 403],
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
    ["concur_user_not_found", 404],
    ["concur_user_ambiguous", 409],
    ["concur_user_link_save_failed", 500],
    ["internal_error", 500],
    ["invalid_json", 400],
  ])("%sは%iへ変換される", (code, expectedStatus) => {
    expect(classifyLinkConcurUserHttpStatus(code)).toBe(expectedStatus);
  });

  it("未知のコードでも例外にならず500へフォールバックする", () => {
    expect(classifyLinkConcurUserHttpStatus("unknown_code")).toBe(500);
  });

  it.each([
    "concur_user_link_invalid_request",
    "forbidden",
    "concur_oauth_not_connected",
    "concur_oauth_completion_failed",
    "concur_oauth_storage_failed",
    "concur_user_link_save_failed",
    "internal_error",
  ])("%sは固定メッセージを持つ", (code) => {
    const error = buildLinkConcurUserError(code);
    expect(error.code).toBe(code);
    expect(typeof error.message).toBe("string");
    expect(error.message.length).toBeGreaterThan(0);
  });
});

describe("buildLinkConcurUserErrorResponse", () => {
  it("エラーコードに応じたHTTPステータスとエラー本文を組み立てる", () => {
    const response = buildLinkConcurUserErrorResponse({ code: "concur_oauth_rate_limited", message: "固定メッセージ" });
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ result: null, error: { code: "concur_oauth_rate_limited", message: "固定メッセージ" } });
  });

  it("resultは常にnull", () => {
    const response = buildLinkConcurUserErrorResponse({ code: "concur_user_link_save_failed", message: "固定メッセージ" });
    expect(response.body.result).toBeNull();
  });
});
