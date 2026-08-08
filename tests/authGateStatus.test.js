import { describe, it, expect } from "vitest";
import { resolveAuthGateView, resolveAdminRoleStatus } from "../src/admin/authGateStatus";

describe("resolveAuthGateView", () => {
  it("Supabase未設定なら、authStatusに関わらず常にlocal", () => {
    expect(resolveAuthGateView({ isSupabaseConfigured: false, authStatus: "loading" })).toBe(
      "local",
    );
    expect(resolveAuthGateView({ isSupabaseConfigured: false, authStatus: "signedIn" })).toBe(
      "local",
    );
    expect(resolveAuthGateView({ isSupabaseConfigured: false, authStatus: "signedOut" })).toBe(
      "local",
    );
  });

  it("設定済み・確認中はloading", () => {
    expect(resolveAuthGateView({ isSupabaseConfigured: true, authStatus: "loading" })).toBe(
      "loading",
    );
  });

  it("設定済み・未ログインはsignedOut", () => {
    expect(resolveAuthGateView({ isSupabaseConfigured: true, authStatus: "signedOut" })).toBe(
      "signedOut",
    );
  });

  it("設定済み・ログイン済みはsignedIn", () => {
    expect(resolveAuthGateView({ isSupabaseConfigured: true, authStatus: "signedIn" })).toBe(
      "signedIn",
    );
  });
});

describe("resolveAdminRoleStatus（Commit 6：会社ごとのroleを前提にした管理画面アクセス判定）", () => {
  it("is_platform_admin()がtrueならplatform_admin（roleの値に関わらず優先）", () => {
    expect(resolveAdminRoleStatus({ role: null, roleError: null, isPlatformAdmin: true, platformError: null })).toBe(
      "platform_admin",
    );
    expect(resolveAdminRoleStatus({ role: "user", roleError: null, isPlatformAdmin: true, platformError: null })).toBe(
      "platform_admin",
    );
  });

  it("platform_adminではないが、どこか1社でrole==='admin'ならcompany_admin", () => {
    expect(
      resolveAdminRoleStatus({ role: "admin", roleError: null, isPlatformAdmin: false, platformError: null }),
    ).toBe("company_admin");
  });

  it("既存1社adminユーザーが壊れない（platform_admin=false、role='admin'）", () => {
    expect(
      resolveAdminRoleStatus({ role: "admin", roleError: null, isPlatformAdmin: false, platformError: null }),
    ).toBe("company_admin");
  });

  it("roleがnull・'user'のいずれでも、platform_adminでなければforbidden", () => {
    expect(resolveAdminRoleStatus({ role: null, roleError: null, isPlatformAdmin: false, platformError: null })).toBe(
      "forbidden",
    );
    expect(
      resolveAdminRoleStatus({ role: "user", roleError: null, isPlatformAdmin: false, platformError: null }),
    ).toBe("forbidden");
  });

  it("roleの取得に失敗した場合はerror", () => {
    expect(
      resolveAdminRoleStatus({
        role: null,
        roleError: { type: "unknown", message: "boom" },
        isPlatformAdmin: false,
        platformError: null,
      }),
    ).toBe("error");
  });

  it("platform_admin判定の取得に失敗した場合もerror", () => {
    expect(
      resolveAdminRoleStatus({
        role: "admin",
        roleError: null,
        isPlatformAdmin: null,
        platformError: { type: "unknown", message: "boom" },
      }),
    ).toBe("error");
  });
});
