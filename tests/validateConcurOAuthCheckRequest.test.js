import { describe, it, expect } from "vitest";
import { validateConcurOAuthCheckRequest } from "../supabase/functions/check-concur-oauth/validateConcurOAuthCheckRequest.js";

// check-concur-oauthのリクエスト本文検証（会社別OAuth接続対応で新規追加）。
// 以前はこのFunctionがrequest bodyを一切読み取らなかったが、対象会社を
// 明示指定できるようcompanyCode（company_code）を必須項目として追加した。

describe("validateConcurOAuthCheckRequest", () => {
  it("正常なcompanyCodeは成功し、trim済みの値を返す", () => {
    expect(validateConcurOAuthCheckRequest({ companyCode: "  connect-company  " })).toEqual({
      ok: true,
      companyCode: "connect-company",
    });
  });

  it("bodyがオブジェクトでない場合は失敗", () => {
    expect(validateConcurOAuthCheckRequest(null).ok).toBe(false);
    expect(validateConcurOAuthCheckRequest(undefined).ok).toBe(false);
    expect(validateConcurOAuthCheckRequest("string").ok).toBe(false);
  });

  it("companyCodeが無い場合は失敗（必須）", () => {
    expect(validateConcurOAuthCheckRequest({}).ok).toBe(false);
  });

  it("companyCodeが空文字・空白のみの場合は失敗", () => {
    expect(validateConcurOAuthCheckRequest({ companyCode: "" }).ok).toBe(false);
    expect(validateConcurOAuthCheckRequest({ companyCode: "   " }).ok).toBe(false);
  });

  it("companyCodeが文字列でない場合は失敗", () => {
    expect(validateConcurOAuthCheckRequest({ companyCode: 123 }).ok).toBe(false);
    expect(validateConcurOAuthCheckRequest({ companyCode: null }).ok).toBe(false);
    expect(validateConcurOAuthCheckRequest({ companyCode: {} }).ok).toBe(false);
  });

  it("余分なフィールド（company UUIDらしき値等）が含まれていても無視する（companyCodeだけを見る）", () => {
    const result = validateConcurOAuthCheckRequest({
      companyCode: "connect-company",
      companyId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result).toEqual({ ok: true, companyCode: "connect-company" });
  });
});
