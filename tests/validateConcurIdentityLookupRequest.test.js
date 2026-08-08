import { describe, it, expect } from "vitest";
import {
  validateConcurIdentityLookupRequest,
  validateConcurUserNameValue,
} from "../supabase/functions/_shared/concur-identity/validateConcurIdentityLookupRequest.js";

const VALID_COMPANY_CODE = "connect-company";

describe("validateConcurIdentityLookupRequest", () => {
  it("正常なuserName・companyCodeは成功し、trim済みの値を返す", () => {
    const result = validateConcurIdentityLookupRequest({ userName: "  user@example.com  ", companyCode: "  connect-company  " });
    expect(result).toEqual({ ok: true, userName: "user@example.com", companyCode: "connect-company" });
  });

  it("bodyがオブジェクトでない場合は失敗", () => {
    expect(validateConcurIdentityLookupRequest(null).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest(undefined).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest("string").ok).toBe(false);
  });

  it("userNameが無い場合は失敗（必須）", () => {
    expect(validateConcurIdentityLookupRequest({ companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
  });

  it("userNameが文字列でない場合は失敗", () => {
    expect(validateConcurIdentityLookupRequest({ userName: 12345, companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest({ userName: null, companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest({ userName: {}, companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
  });

  it("trim後に空文字になる場合は失敗", () => {
    expect(validateConcurIdentityLookupRequest({ userName: "   ", companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest({ userName: "", companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
  });

  it("過度に長い値は拒否する", () => {
    const tooLong = `${"a".repeat(310)}@example.com`; // 320文字超
    expect(tooLong.length).toBeGreaterThan(320);
    expect(validateConcurIdentityLookupRequest({ userName: tooLong, companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
  });

  it("上限文字数ちょうどは許可する", () => {
    const exactly320 = `${"a".repeat(308)}@example.com`; // ちょうど320文字
    expect(exactly320.length).toBe(320);
    expect(validateConcurIdentityLookupRequest({ userName: exactly320, companyCode: VALID_COMPANY_CODE }).ok).toBe(true);
  });

  it.each(["%", "[", "]", "#", "!", "*", "&", "(", ")", "~", "'", "{", "^", "}", "\\", "/", "?", ">", "<", ",", ";", ":", '"', "+", "=", "|"])(
    "公式ドキュメントが禁止する文字（%s）を含む場合は拒否する",
    (forbiddenChar) => {
      const result = validateConcurIdentityLookupRequest({ userName: `user${forbiddenChar}name@example.com`, companyCode: VALID_COMPANY_CODE });
      expect(result.ok).toBe(false);
    },
  );

  it("通常のメールアドレス形式のuserNameを許可する", () => {
    expect(validateConcurIdentityLookupRequest({ userName: "john.doe@example.com", companyCode: VALID_COMPANY_CODE }).ok).toBe(true);
  });

  it("失敗時、入力値そのものを結果へ含めない（ログ・レスポンスへの反射防止の一環）", () => {
    const secretLikeInput = "SHOULD_NOT_BE_REFLECTED@example.com   ";
    const result = validateConcurIdentityLookupRequest({ userName: `${secretLikeInput}%`, companyCode: VALID_COMPANY_CODE });
    expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_BE_REFLECTED");
  });

  // 【会社別OAuth接続対応で追加】companyCode（company_code）の検証。
  // resolve_concur_oauth_company_id RPCへ渡すp_company_codeの入力になる
  // （検証自体は_shared/validateCompanyCodeValue.jsへ委譲）。
  describe("companyCode（会社別OAuth接続対応で追加）", () => {
    it("companyCodeが無い場合は失敗（必須）。userNameが正しくても通らない", () => {
      expect(validateConcurIdentityLookupRequest({ userName: "user@example.com" }).ok).toBe(false);
    });

    it("companyCodeが空文字・空白のみの場合は失敗", () => {
      expect(validateConcurIdentityLookupRequest({ userName: "user@example.com", companyCode: "" }).ok).toBe(false);
      expect(validateConcurIdentityLookupRequest({ userName: "user@example.com", companyCode: "   " }).ok).toBe(false);
    });

    it("companyCodeが文字列でない場合は失敗", () => {
      expect(validateConcurIdentityLookupRequest({ userName: "user@example.com", companyCode: 123 }).ok).toBe(false);
      expect(validateConcurIdentityLookupRequest({ userName: "user@example.com", companyCode: null }).ok).toBe(false);
    });

    it("userNameが不正な場合、companyCodeが正しくても通らない（両方とも検証される）", () => {
      expect(validateConcurIdentityLookupRequest({ userName: "", companyCode: VALID_COMPANY_CODE }).ok).toBe(false);
    });

    it("companyCodeもtrimして返す", () => {
      const result = validateConcurIdentityLookupRequest({ userName: "user@example.com", companyCode: "  connect-company  " });
      expect(result.companyCode).toBe("connect-company");
    });
  });
});

// validateConcurUserNameValue()は、create-concur-quick-expense（ConcurログインID）
// からも同じ判定基準を再利用するために公開した部分。
// validateConcurIdentityLookupRequest()自身の挙動は上のテストで検証済みのため、
// ここでは「値1件を直接渡す」という呼び出し方自体が正しく動くことだけを確認する。
describe("validateConcurUserNameValue（他Edge Functionからの再利用のために公開した部分）", () => {
  it("validateConcurIdentityLookupRequest({userName, companyCode})のuserName部分と同じ結果を返す", () => {
    expect(validateConcurUserNameValue("  user@example.com  ")).toEqual({ ok: true, userName: "user@example.com" });
    expect(validateConcurUserNameValue("")).toEqual({ ok: false });
    expect(validateConcurUserNameValue(undefined)).toEqual({ ok: false });
    expect(validateConcurUserNameValue("bad%name")).toEqual({ ok: false });
  });
});
