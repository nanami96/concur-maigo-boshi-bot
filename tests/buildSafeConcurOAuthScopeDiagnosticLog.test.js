import { describe, it, expect } from "vitest";
import { buildSafeConcurOAuthScopeDiagnosticLog } from "../supabase/functions/_shared/concur-identity/buildSafeConcurOAuthScopeDiagnosticLog.js";

describe("buildSafeConcurOAuthScopeDiagnosticLog（正常系）", () => {
  it("identity.user.ids.readを含む場合はhasIdentityUserIdsRead:true", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: "identity.user.ids.read expense.report.read" });

    expect(result).toEqual({
      stage: "concur_oauth_scope_diagnostic",
      scopePresent: true,
      hasIdentityUserIdsRead: true,
    });
  });

  it("identity.user.ids.readを含まない場合はfalse", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: "expense.report.read expense.report.write" });
    expect(result.scopePresent).toBe(true);
    expect(result.hasIdentityUserIdsRead).toBe(false);
  });

  it("先頭・末尾・単独でもtrueと判定する", () => {
    expect(buildSafeConcurOAuthScopeDiagnosticLog({ scope: "identity.user.ids.read expense.report.read" }).hasIdentityUserIdsRead).toBe(true);
    expect(buildSafeConcurOAuthScopeDiagnosticLog({ scope: "expense.report.read identity.user.ids.read" }).hasIdentityUserIdsRead).toBe(true);
    expect(buildSafeConcurOAuthScopeDiagnosticLog({ scope: "identity.user.ids.read" }).hasIdentityUserIdsRead).toBe(true);
  });

  it("タブ・改行など空白文字全般で分割する", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: "expense.report.read\tidentity.user.ids.read\nother.scope" });
    expect(result.hasIdentityUserIdsRead).toBe(true);
  });
});

describe("buildSafeConcurOAuthScopeDiagnosticLog（部分一致は不一致）", () => {
  it("前方一致（余分な接尾辞）はfalse", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: "identity.user.ids.read.extra" });
    expect(result.hasIdentityUserIdsRead).toBe(false);
  });

  it("後方一致（余分な接頭辞）はfalse", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: "prefix.identity.user.ids.read" });
    expect(result.hasIdentityUserIdsRead).toBe(false);
  });

  it("大文字小文字違いはfalse（完全一致のみ）", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: "IDENTITY.USER.IDS.READ" });
    expect(result.hasIdentityUserIdsRead).toBe(false);
  });

  it("似た別のscope名だけの場合はfalse", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: "identity.user.read expense.report.read" });
    expect(result.hasIdentityUserIdsRead).toBe(false);
  });
});

describe("buildSafeConcurOAuthScopeDiagnosticLog（scope未返却・異常系）", () => {
  it("scopeがnullの場合はscopePresent:false・hasIdentityUserIdsRead:false", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: null });
    expect(result.scopePresent).toBe(false);
    expect(result.hasIdentityUserIdsRead).toBe(false);
  });

  it("scopeがundefinedの場合も同様", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({ scope: undefined });
    expect(result.scopePresent).toBe(false);
    expect(result.hasIdentityUserIdsRead).toBe(false);
  });

  it("scopeが空文字・空白のみの場合もscopePresent:false", () => {
    expect(buildSafeConcurOAuthScopeDiagnosticLog({ scope: "" }).scopePresent).toBe(false);
    expect(buildSafeConcurOAuthScopeDiagnosticLog({ scope: "   " }).scopePresent).toBe(false);
  });
});

describe("buildSafeConcurOAuthScopeDiagnosticLog（非露出の確認）", () => {
  it("戻り値にscopeの生値・他のscope名が一切含まれない（真偽値2つとstageのみ）", () => {
    const result = buildSafeConcurOAuthScopeDiagnosticLog({
      scope: "identity.user.ids.read expense.report.read company.secret.scope",
    });

    expect(Object.keys(result).sort()).toEqual(["hasIdentityUserIdsRead", "scopePresent", "stage"].sort());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("expense.report.read");
    expect(serialized).not.toContain("company.secret.scope");
    expect(serialized).not.toContain("identity.user.ids.read");
  });
});
