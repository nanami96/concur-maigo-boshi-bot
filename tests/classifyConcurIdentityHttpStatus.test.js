import { describe, it, expect } from "vitest";
import { classifyConcurIdentityHttpStatus } from "../supabase/functions/_shared/concur-identity/classifyConcurIdentityHttpStatus.js";

describe("classifyConcurIdentityHttpStatus", () => {
  it.each([200, 201, 204, 299])("2xx（%i）はnull（エラーではない）", (status) => {
    expect(classifyConcurIdentityHttpStatus(status)).toBeNull();
  });

  it("429はconcur_identity_rate_limited", () => {
    expect(classifyConcurIdentityHttpStatus(429)).toBe("concur_identity_rate_limited");
  });

  it.each([500, 501, 502, 503, 504])("5xx（%i）はconcur_identity_service_error", (status) => {
    expect(classifyConcurIdentityHttpStatus(status)).toBe("concur_identity_service_error");
  });

  it.each([401, 403])("401/403（%i）はconcur_identity_rejected", (status) => {
    expect(classifyConcurIdentityHttpStatus(status)).toBe("concur_identity_rejected");
  });

  it.each([400, 404])("400/404（%i、429以外の4xx）はconcur_identity_invalid_response", (status) => {
    expect(classifyConcurIdentityHttpStatus(status)).toBe("concur_identity_invalid_response");
  });

  it("3xx（想定外の応答）はconcur_identity_invalid_response", () => {
    expect(classifyConcurIdentityHttpStatus(302)).toBe("concur_identity_invalid_response");
  });

  it("数値でない場合はconcur_identity_invalid_response", () => {
    expect(classifyConcurIdentityHttpStatus(undefined)).toBe("concur_identity_invalid_response");
    expect(classifyConcurIdentityHttpStatus(null)).toBe("concur_identity_invalid_response");
    expect(classifyConcurIdentityHttpStatus("200")).toBe("concur_identity_invalid_response");
  });
});
