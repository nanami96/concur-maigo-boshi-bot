import { describe, it, expect } from "vitest";
import { evaluateConcurRequiredScopes } from "../supabase/functions/_shared/concur-oauth/evaluateConcurRequiredScopes.js";

describe("evaluateConcurRequiredScopes（正常系）", () => {
  it("3scopeすべて含む場合、すべてtrue", () => {
    const result = evaluateConcurRequiredScopes("quickexpense.writeonly user.read identity.user.ids.read");

    expect(result).toEqual({
      scopePresent: true,
      hasQuickExpenseWriteScope: true,
      hasUserReadScope: true,
      hasIdentityUserIdsReadScope: true,
    });
  });

  it("1つだけ含む場合、該当するものだけtrue", () => {
    const result = evaluateConcurRequiredScopes("expense.report.read user.read");

    expect(result.scopePresent).toBe(true);
    expect(result.hasQuickExpenseWriteScope).toBe(false);
    expect(result.hasUserReadScope).toBe(true);
    expect(result.hasIdentityUserIdsReadScope).toBe(false);
  });

  it("先頭・末尾・単独でもtrueと判定する", () => {
    expect(evaluateConcurRequiredScopes("quickexpense.writeonly other.scope").hasQuickExpenseWriteScope).toBe(true);
    expect(evaluateConcurRequiredScopes("other.scope quickexpense.writeonly").hasQuickExpenseWriteScope).toBe(true);
    expect(evaluateConcurRequiredScopes("quickexpense.writeonly").hasQuickExpenseWriteScope).toBe(true);
  });

  it("タブ・改行・複数空白区切りでも判定できる", () => {
    const result = evaluateConcurRequiredScopes("quickexpense.writeonly\tuser.read\n\nidentity.user.ids.read");

    expect(result.hasQuickExpenseWriteScope).toBe(true);
    expect(result.hasUserReadScope).toBe(true);
    expect(result.hasIdentityUserIdsReadScope).toBe(true);
  });
});

describe("evaluateConcurRequiredScopes（部分一致・大文字小文字違いは不一致）", () => {
  it("前方一致（余分な接尾辞）はfalse", () => {
    expect(evaluateConcurRequiredScopes("quickexpense.writeonly.extra").hasQuickExpenseWriteScope).toBe(false);
  });

  it("後方一致（余分な接頭辞）はfalse", () => {
    expect(evaluateConcurRequiredScopes("prefix.user.read").hasUserReadScope).toBe(false);
  });

  it("大文字小文字違いはfalse（完全一致のみ）", () => {
    expect(evaluateConcurRequiredScopes("QUICKEXPENSE.WRITEONLY").hasQuickExpenseWriteScope).toBe(false);
    expect(evaluateConcurRequiredScopes("User.Read").hasUserReadScope).toBe(false);
    expect(evaluateConcurRequiredScopes("Identity.User.Ids.Read").hasIdentityUserIdsReadScope).toBe(false);
  });

  it("似た別のscope名だけの場合はfalse", () => {
    expect(evaluateConcurRequiredScopes("identity.user.read").hasIdentityUserIdsReadScope).toBe(false);
  });
});

describe("evaluateConcurRequiredScopes（scope未返却・異常系）", () => {
  it("scopeがundefinedの場合はscopePresent:falseかつ3つともfalse", () => {
    const result = evaluateConcurRequiredScopes(undefined);
    expect(result).toEqual({
      scopePresent: false,
      hasQuickExpenseWriteScope: false,
      hasUserReadScope: false,
      hasIdentityUserIdsReadScope: false,
    });
  });

  it("scopeがnullの場合も同様", () => {
    expect(evaluateConcurRequiredScopes(null).scopePresent).toBe(false);
  });

  it("scopeが空文字・空白のみの場合もscopePresent:false", () => {
    expect(evaluateConcurRequiredScopes("").scopePresent).toBe(false);
    expect(evaluateConcurRequiredScopes("   ").scopePresent).toBe(false);
  });

  it("scopeが数値・オブジェクト等の非文字列の場合もscopePresent:false（例外にならない）", () => {
    expect(evaluateConcurRequiredScopes(12345).scopePresent).toBe(false);
    expect(evaluateConcurRequiredScopes({}).scopePresent).toBe(false);
  });
});

describe("evaluateConcurRequiredScopes（非露出の確認）", () => {
  it("戻り値にscopeの生値・他のscope名が一切含まれない（真偽値4つのみ）", () => {
    const result = evaluateConcurRequiredScopes(
      "quickexpense.writeonly user.read identity.user.ids.read company.secret.scope",
    );

    expect(Object.keys(result).sort()).toEqual(
      ["scopePresent", "hasQuickExpenseWriteScope", "hasUserReadScope", "hasIdentityUserIdsReadScope"].sort(),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("company.secret.scope");
    expect(serialized).not.toContain("quickexpense.writeonly user.read");
  });
});
