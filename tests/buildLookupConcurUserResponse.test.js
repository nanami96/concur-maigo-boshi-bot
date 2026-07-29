import { describe, it, expect } from "vitest";
import {
  buildLookupConcurUserError,
  classifyLookupConcurUserHttpStatus,
  buildLookupConcurUserSuccessResponse,
  buildLookupConcurUserErrorResponse,
} from "../supabase/functions/lookup-concur-user/buildLookupConcurUserResponse.js";

describe("buildLookupConcurUserSuccessResponse", () => {
  it("found:true・hasUserId:true・multipleMatches:falseを200で返す", () => {
    const response = buildLookupConcurUserSuccessResponse({ found: true, hasUserId: true, multipleMatches: false });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: { found: true, hasUserId: true, multipleMatches: false },
      error: null,
    });
  });

  it("真偽値以外の値が渡されてもBoolean化する", () => {
    const response = buildLookupConcurUserSuccessResponse({ found: 1, hasUserId: "yes", multipleMatches: 0 });

    expect(response.body.result).toEqual({ found: true, hasUserId: true, multipleMatches: false });
  });

  it("成功レスポンスにuserID実値・利用者プロフィールに相当する追加フィールドを含めない", () => {
    const response = buildLookupConcurUserSuccessResponse({ found: true, hasUserId: true, multipleMatches: false });

    expect(Object.keys(response.body.result).sort()).toEqual(["found", "hasUserId", "multipleMatches"].sort());
  });
});

describe("classifyLookupConcurUserHttpStatus / buildLookupConcurUserError", () => {
  const CASES = [
    ["concur_oauth_not_connected", 503],
    ["concur_oauth_completion_failed", 500],
    ["concur_oauth_storage_failed", 500],
    ["internal_error", 500],
    ["concur_identity_invalid_request", 400],
    ["concur_not_configured", 500],
    ["concur_oauth_timeout", 504],
    ["concur_oauth_network_error", 502],
    ["concur_oauth_rejected", 502],
    ["concur_oauth_rate_limited", 429],
    ["concur_oauth_service_error", 502],
    ["concur_oauth_invalid_response", 502],
    ["concur_user_not_found", 404],
    ["concur_user_ambiguous", 409],
    ["concur_identity_geolocation_missing", 500],
    ["concur_identity_invalid_response", 502],
    ["concur_identity_rejected", 502],
    ["concur_identity_rate_limited", 429],
    ["concur_identity_service_error", 502],
    ["concur_identity_timeout", 504],
    ["concur_identity_network_error", 502],
  ];

  it.each(CASES)("%sはHTTP %i", (code, expectedStatus) => {
    expect(classifyLookupConcurUserHttpStatus(code)).toBe(expectedStatus);
  });

  it("未知のコードは既定で500", () => {
    expect(classifyLookupConcurUserHttpStatus("unknown_code_xyz")).toBe(500);
  });

  it("buildLookupConcurUserErrorはローカル専用コードに固定メッセージを返す", () => {
    expect(buildLookupConcurUserError("concur_oauth_not_connected").message).toBe("現在Concurとの接続情報を利用できません。");
    expect(buildLookupConcurUserError("concur_oauth_completion_failed").message).toBe("処理を確定できませんでした。もう一度お試しください。");
    expect(buildLookupConcurUserError("concur_oauth_storage_failed").message).toBe("認証情報の保存に失敗しました。もう一度お試しください。");
  });

  it("未知のコードにも固定の既定メッセージを返す（例外にならない）", () => {
    expect(buildLookupConcurUserError("unknown_code_xyz").message).toBe("処理中にエラーが発生しました。");
  });
});

describe("buildLookupConcurUserErrorResponse", () => {
  it("codeに対応するHTTPステータスとerrorオブジェクトをそのまま返す", () => {
    const error = { code: "concur_user_not_found", message: "指定された利用者情報が見つかりませんでした。" };
    const response = buildLookupConcurUserErrorResponse(error);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ result: null, error });
  });

  it("resultは常にnull", () => {
    const response = buildLookupConcurUserErrorResponse({ code: "concur_identity_timeout", message: "x" });
    expect(response.body.result).toBeNull();
  });
});

describe("固定文言のみであることの回帰確認", () => {
  it("全メッセージがConcurの生レスポンス・Token・error_descriptionに相当する文字列を含まない", () => {
    const ALL_CODES = [
      "concur_oauth_not_connected",
      "concur_oauth_completion_failed",
      "concur_oauth_storage_failed",
      "internal_error",
      "unknown_code_xyz",
    ];

    ALL_CODES.forEach((code) => {
      const { message } = buildLookupConcurUserError(code);
      expect(message).not.toMatch(/token/i);
      expect(message).not.toMatch(/error_description/i);
      expect(message).not.toMatch(/secret/i);
    });
  });
});
