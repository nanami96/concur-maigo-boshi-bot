import { describe, it, expect } from "vitest";
import { validateLinkConcurUserRequest } from "../supabase/functions/link-concur-user/validateLinkConcurUserRequest.js";

describe("validateLinkConcurUserRequest", () => {
  it("正常なcompanyCode・concurLoginIdは成功し、trim済みの値を返す", () => {
    expect(
      validateLinkConcurUserRequest({ companyCode: "  connect-company  ", concurLoginId: "  user@example.com  " }),
    ).toEqual({ ok: true, companyCode: "connect-company", concurLoginId: "user@example.com" });
  });

  it("bodyがオブジェクトでない場合は失敗", () => {
    expect(validateLinkConcurUserRequest(null).ok).toBe(false);
    expect(validateLinkConcurUserRequest(undefined).ok).toBe(false);
    expect(validateLinkConcurUserRequest("string").ok).toBe(false);
  });

  it("companyCodeが無い場合は失敗", () => {
    expect(validateLinkConcurUserRequest({ concurLoginId: "user@example.com" }).ok).toBe(false);
  });

  it("concurLoginIdが無い場合は失敗", () => {
    expect(validateLinkConcurUserRequest({ companyCode: "connect-company" }).ok).toBe(false);
  });

  it("concurLoginIdが空白のみの場合は失敗", () => {
    expect(
      validateLinkConcurUserRequest({ companyCode: "connect-company", concurLoginId: "   " }).ok,
    ).toBe(false);
  });

  it("concurLoginIdが禁止文字を含む場合は失敗（Concur公式の禁止文字と同じ基準）", () => {
    expect(
      validateLinkConcurUserRequest({ companyCode: "connect-company", concurLoginId: "user%name" }).ok,
    ).toBe(false);
  });

  it("companyCodeが文字列でない場合は失敗", () => {
    expect(
      validateLinkConcurUserRequest({ companyCode: 123, concurLoginId: "user@example.com" }).ok,
    ).toBe(false);
  });

  it("余分なフィールド（company UUIDらしき値等）が含まれていても無視する", () => {
    const result = validateLinkConcurUserRequest({
      companyCode: "connect-company",
      concurLoginId: "user@example.com",
      companyId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result).toEqual({ ok: true, companyCode: "connect-company", concurLoginId: "user@example.com" });
  });
});
