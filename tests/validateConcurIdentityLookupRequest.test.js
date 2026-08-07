import { describe, it, expect } from "vitest";
import {
  validateConcurIdentityLookupRequest,
  validateConcurUserNameValue,
} from "../supabase/functions/_shared/concur-identity/validateConcurIdentityLookupRequest.js";

describe("validateConcurIdentityLookupRequest", () => {
  it("正常なuserNameは成功し、trim済みの値を返す", () => {
    const result = validateConcurIdentityLookupRequest({ userName: "  user@example.com  " });
    expect(result).toEqual({ ok: true, userName: "user@example.com" });
  });

  it("bodyがオブジェクトでない場合は失敗", () => {
    expect(validateConcurIdentityLookupRequest(null).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest(undefined).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest("string").ok).toBe(false);
  });

  it("userNameが無い場合は失敗（必須）", () => {
    expect(validateConcurIdentityLookupRequest({}).ok).toBe(false);
  });

  it("userNameが文字列でない場合は失敗", () => {
    expect(validateConcurIdentityLookupRequest({ userName: 12345 }).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest({ userName: null }).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest({ userName: {} }).ok).toBe(false);
  });

  it("trim後に空文字になる場合は失敗", () => {
    expect(validateConcurIdentityLookupRequest({ userName: "   " }).ok).toBe(false);
    expect(validateConcurIdentityLookupRequest({ userName: "" }).ok).toBe(false);
  });

  it("過度に長い値は拒否する", () => {
    const tooLong = `${"a".repeat(310)}@example.com`; // 320文字超
    expect(tooLong.length).toBeGreaterThan(320);
    expect(validateConcurIdentityLookupRequest({ userName: tooLong }).ok).toBe(false);
  });

  it("上限文字数ちょうどは許可する", () => {
    const exactly320 = `${"a".repeat(308)}@example.com`; // ちょうど320文字
    expect(exactly320.length).toBe(320);
    expect(validateConcurIdentityLookupRequest({ userName: exactly320 }).ok).toBe(true);
  });

  it.each(["%", "[", "]", "#", "!", "*", "&", "(", ")", "~", "'", "{", "^", "}", "\\", "/", "?", ">", "<", ",", ";", ":", '"', "+", "=", "|"])(
    "公式ドキュメントが禁止する文字（%s）を含む場合は拒否する",
    (forbiddenChar) => {
      const result = validateConcurIdentityLookupRequest({ userName: `user${forbiddenChar}name@example.com` });
      expect(result.ok).toBe(false);
    },
  );

  it("通常のメールアドレス形式のuserNameを許可する", () => {
    expect(validateConcurIdentityLookupRequest({ userName: "john.doe@example.com" }).ok).toBe(true);
  });

  it("失敗時、入力値そのものを結果へ含めない（ログ・レスポンスへの反射防止の一環）", () => {
    const secretLikeInput = "SHOULD_NOT_BE_REFLECTED@example.com   ";
    const result = validateConcurIdentityLookupRequest({ userName: `${secretLikeInput}%` });
    expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_BE_REFLECTED");
  });
});

// validateConcurUserNameValue()は、create-concur-quick-expense（ConcurログインID）
// からも同じ判定基準を再利用するために公開した部分。
// validateConcurIdentityLookupRequest()自身の挙動は上のテストで検証済みのため、
// ここでは「値1件を直接渡す」という呼び出し方自体が正しく動くことだけを確認する。
describe("validateConcurUserNameValue（他Edge Functionからの再利用のために公開した部分）", () => {
  it("validateConcurIdentityLookupRequest({userName})と同じ結果を返す", () => {
    expect(validateConcurUserNameValue("  user@example.com  ")).toEqual({ ok: true, userName: "user@example.com" });
    expect(validateConcurUserNameValue("")).toEqual({ ok: false });
    expect(validateConcurUserNameValue(undefined)).toEqual({ ok: false });
    expect(validateConcurUserNameValue("bad%name")).toEqual({ ok: false });
  });
});
