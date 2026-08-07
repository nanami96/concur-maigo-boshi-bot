import { describe, it, expect } from "vitest";
import { buildQuickExpenseUpstreamErrorResponse } from "../supabase/functions/create-concur-quick-expense/buildQuickExpenseUpstreamErrorResponse.js";

describe("buildQuickExpenseUpstreamErrorResponse", () => {
  it.each([
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
  ])("%sはHTTP %iへ分類される", (code, expectedStatus) => {
    const { status } = buildQuickExpenseUpstreamErrorResponse({ code, message: "固定メッセージ" });
    expect(status).toBe(expectedStatus);
  });

  it("未知のコードは既定で500", () => {
    const { status } = buildQuickExpenseUpstreamErrorResponse({ code: "unknown_code", message: "m" });
    expect(status).toBe(500);
  });

  it("bodyはcode・message・空のdetailsだけを持つ固定形（resultはnull）", () => {
    const { body } = buildQuickExpenseUpstreamErrorResponse({ code: "concur_user_not_found", message: "指定された利用者情報が見つかりませんでした。" });

    expect(body).toEqual({
      result: null,
      error: { code: "concur_user_not_found", message: "指定された利用者情報が見つかりませんでした。", details: [] },
    });
  });

  it("渡されたerrorオブジェクト自体を変更しない・余計なフィールドを追加しない", () => {
    const error = { code: "concur_identity_rejected", message: "固定メッセージ" };
    const { body } = buildQuickExpenseUpstreamErrorResponse(error);

    expect(error).toEqual({ code: "concur_identity_rejected", message: "固定メッセージ" });
    expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message"]);
  });
});
