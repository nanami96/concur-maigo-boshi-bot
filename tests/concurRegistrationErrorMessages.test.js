import { describe, it, expect } from "vitest";
import {
  classifyConcurRegistrationErrorCategory,
  resolveConcurRegistrationErrorMessage,
} from "../src/concurRegistrationErrorMessages.js";

describe("classifyConcurRegistrationErrorCategory", () => {
  it("unauthorizedはunauthorizedへ分類される", () => {
    expect(classifyConcurRegistrationErrorCategory("unauthorized")).toBe("unauthorized");
  });

  it("auth_errorはauth_errorへ分類される（将来のOAuth関連エラー用の受け皿）", () => {
    expect(classifyConcurRegistrationErrorCategory("auth_error")).toBe("auth_error");
  });

  it("forbidden・mapping_not_found・multiple_mappings_foundはいずれもforbiddenへ分類される", () => {
    expect(classifyConcurRegistrationErrorCategory("forbidden")).toBe("forbidden");
    expect(classifyConcurRegistrationErrorCategory("mapping_not_found")).toBe("forbidden");
    expect(classifyConcurRegistrationErrorCategory("multiple_mappings_found")).toBe("forbidden");
  });

  it("validation_error・invalid_jsonはいずれもvalidation_errorへ分類される", () => {
    expect(classifyConcurRegistrationErrorCategory("validation_error")).toBe("validation_error");
    expect(classifyConcurRegistrationErrorCategory("invalid_json")).toBe("validation_error");
  });

  it("timeoutはtimeoutへ分類される", () => {
    expect(classifyConcurRegistrationErrorCategory("timeout")).toBe("timeout");
  });

  it("network（classifyQuickExpenseFunctionErrorの実際の値）はnetwork_errorへ分類される", () => {
    expect(classifyConcurRegistrationErrorCategory("network")).toBe("network_error");
  });

  it("internal_error・method_not_allowedはいずれもfunction_errorへ分類される", () => {
    expect(classifyConcurRegistrationErrorCategory("internal_error")).toBe("function_error");
    expect(classifyConcurRegistrationErrorCategory("method_not_allowed")).toBe("function_error");
  });

  it("【Phase 13で追加】concur_user_not_foundはuser_not_foundへ、concur_user_ambiguousはuser_ambiguousへ分類される", () => {
    expect(classifyConcurRegistrationErrorCategory("concur_user_not_found")).toBe("user_not_found");
    expect(classifyConcurRegistrationErrorCategory("concur_user_ambiguous")).toBe("user_ambiguous");
  });

  it("unknown（実際の値）・未知の値・null・undefinedはいずれもunknown_errorへ分類される（安全側）", () => {
    expect(classifyConcurRegistrationErrorCategory("unknown")).toBe("unknown_error");
    expect(classifyConcurRegistrationErrorCategory("something_never_defined")).toBe("unknown_error");
    expect(classifyConcurRegistrationErrorCategory(null)).toBe("unknown_error");
    expect(classifyConcurRegistrationErrorCategory(undefined)).toBe("unknown_error");
  });
});

describe("resolveConcurRegistrationErrorMessage", () => {
  it("8種のカテゴリすべてで固定の日本語メッセージ（空でない文字列）を返す", () => {
    const types = [
      "unauthorized",
      "auth_error",
      "forbidden",
      "validation_error",
      "timeout",
      "network",
      "internal_error",
      "unknown",
      "concur_user_not_found",
      "concur_user_ambiguous",
    ];
    for (const type of types) {
      const message = resolveConcurRegistrationErrorMessage({ type });
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("【Phase 13で追加】concur_user_not_found・concur_user_ambiguousは互いに異なる固定メッセージを持つ", () => {
    const notFound = resolveConcurRegistrationErrorMessage({ type: "concur_user_not_found" });
    const ambiguous = resolveConcurRegistrationErrorMessage({ type: "concur_user_ambiguous" });
    expect(notFound).not.toBe(ambiguous);
  });

  it("errorがnull・undefinedでも例外にならず、unknown_error相当のメッセージを返す", () => {
    expect(resolveConcurRegistrationErrorMessage(null)).toBe(resolveConcurRegistrationErrorMessage({ type: "unknown" }));
    expect(resolveConcurRegistrationErrorMessage(undefined)).toBe(resolveConcurRegistrationErrorMessage({ type: "unknown" }));
  });

  it("error.messageに含まれる値（Secrets・トークン・レスポンス本文相当の生の文字列）は一切使わず、固定メッセージだけを返す", () => {
    const message = resolveConcurRegistrationErrorMessage({
      type: "network",
      message: "SECRET_TOKEN_LEAK_abc123",
      details: [{ field: "companyId", reason: "internal-detail-should-not-leak" }],
    });
    expect(message).not.toContain("SECRET_TOKEN_LEAK_abc123");
    expect(message).not.toContain("internal-detail-should-not-leak");
  });
});
