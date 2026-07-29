import { describe, it, expect } from "vitest";
import { buildConcurOAuthError } from "../supabase/functions/_shared/concur-oauth/classifyConcurOAuthError.js";

describe("buildConcurOAuthError", () => {
  it.each([
    "concur_not_configured",
    "concur_oauth_timeout",
    "concur_oauth_network_error",
    "concur_oauth_rejected",
    "concur_oauth_rate_limited",
    "concur_oauth_service_error",
    "concur_oauth_invalid_response",
  ])("%sは固定のcode・messageを返す", (code) => {
    const error = buildConcurOAuthError(code);

    expect(error.code).toBe(code);
    expect(typeof error.message).toBe("string");
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("未知のcodeでも例外にならず既定メッセージを返す", () => {
    const error = buildConcurOAuthError("unknown_code");

    expect(error.code).toBe("unknown_code");
    expect(typeof error.message).toBe("string");
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("メッセージにOAuthサーバーのerror_description相当の生の文言を含めない（固定文言のみ）", () => {
    const rawErrorDescription = "invalid_grant: refresh token is expired or revoked";

    Object.values({
      concur_oauth_rejected: buildConcurOAuthError("concur_oauth_rejected"),
      concur_oauth_service_error: buildConcurOAuthError("concur_oauth_service_error"),
    }).forEach((error) => {
      expect(error.message).not.toContain(rawErrorDescription);
    });
  });
});
