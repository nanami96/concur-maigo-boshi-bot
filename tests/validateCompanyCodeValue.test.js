import { describe, it, expect } from "vitest";
import { validateCompanyCodeValue } from "../supabase/functions/_shared/validateCompanyCodeValue.js";

// 会社別Concur OAuth接続対応（check-concur-oauth・lookup-concur-userの両方が
// resolve_concur_oauth_company_id RPCへ渡すp_company_codeの検証に使う）の
// 共通バリデータ。company_code自体の実在確認・所属確認はサーバー側RPCの
// 責務のため、ここでは「非空文字列であること」だけを確認する
// （create-concur-quick-expense/validateQuickExpenseRequest.jsのcompanyId
// フィールドと同じ方針）。

describe("validateCompanyCodeValue", () => {
  it("非空文字列の場合はtrim済みの値を返す", () => {
    expect(validateCompanyCodeValue("connect-company")).toEqual({ ok: true, companyCode: "connect-company" });
  });

  it("前後に空白がある場合はtrimして返す", () => {
    expect(validateCompanyCodeValue("  connect-company  ")).toEqual({ ok: true, companyCode: "connect-company" });
  });

  it("空文字はng", () => {
    expect(validateCompanyCodeValue("")).toEqual({ ok: false });
  });

  it("空白のみはng", () => {
    expect(validateCompanyCodeValue("   ")).toEqual({ ok: false });
  });

  it("undefinedはng", () => {
    expect(validateCompanyCodeValue(undefined)).toEqual({ ok: false });
  });

  it("nullはng", () => {
    expect(validateCompanyCodeValue(null)).toEqual({ ok: false });
  });

  it("文字列でない値（数値・オブジェクト・配列等）はng", () => {
    expect(validateCompanyCodeValue(123)).toEqual({ ok: false });
    expect(validateCompanyCodeValue({ company_id: "uuid" })).toEqual({ ok: false });
    expect(validateCompanyCodeValue(["connect-company"])).toEqual({ ok: false });
  });

  it("UUIDらしき文字列が渡されても、形式上は単なる文字列として受理する（実在・所属確認はRPC側の責務）", () => {
    // このバリデータ自体は「company_codeという名目で送られてきた値」を
    // 拒否する理由を持たない。クライアントがcompany UUIDらしき値を
    // company_codeとして送ってきても、resolve_concur_oauth_company_id側の
    // company_code一致条件で単に該当行が無い（0行）として扱われるだけで、
    // 別の会社のUUIDとして誤って解釈される経路にはならない
    // （呼び出し元がこの値をp_company_codeとしてのみ渡すため）。
    expect(validateCompanyCodeValue("11111111-1111-1111-1111-111111111111")).toEqual({
      ok: true,
      companyCode: "11111111-1111-1111-1111-111111111111",
    });
  });
});
