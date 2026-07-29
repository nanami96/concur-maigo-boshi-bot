import { describe, it, expect } from "vitest";
import { classifyConcurOAuthHttpStatus } from "../supabase/functions/_shared/concur-oauth/classifyConcurOAuthHttpStatus.js";

describe("classifyConcurOAuthHttpStatus", () => {
  it.each([200, 201, 204, 299])("2xx(%i)はnull（正常、後続の検証へ進む）", (status) => {
    expect(classifyConcurOAuthHttpStatus(status)).toBeNull();
  });

  it("400はconcur_oauth_rejected", () => {
    expect(classifyConcurOAuthHttpStatus(400)).toBe("concur_oauth_rejected");
  });

  it("401はconcur_oauth_rejected", () => {
    expect(classifyConcurOAuthHttpStatus(401)).toBe("concur_oauth_rejected");
  });

  it.each([403, 404, 405, 422])(
    "429以外の4xx(%i)も一律concur_oauth_rejectedにまとめる（invalid_responseとは区別しない）",
    (status) => {
      expect(classifyConcurOAuthHttpStatus(status)).toBe("concur_oauth_rejected");
    },
  );

  it("429はconcur_oauth_rate_limited", () => {
    expect(classifyConcurOAuthHttpStatus(429)).toBe("concur_oauth_rate_limited");
  });

  it.each([500, 502, 503])("5xx(%i)はconcur_oauth_service_error", (status) => {
    expect(classifyConcurOAuthHttpStatus(status)).toBe("concur_oauth_service_error");
  });

  it("想定外のステータス（3xx等）はconcur_oauth_invalid_response", () => {
    expect(classifyConcurOAuthHttpStatus(302)).toBe("concur_oauth_invalid_response");
  });

  it("statusが数値でない場合もconcur_oauth_invalid_response（例外にならない）", () => {
    expect(classifyConcurOAuthHttpStatus(undefined)).toBe("concur_oauth_invalid_response");
    expect(classifyConcurOAuthHttpStatus(null)).toBe("concur_oauth_invalid_response");
    expect(classifyConcurOAuthHttpStatus("200")).toBe("concur_oauth_invalid_response");
  });
});
