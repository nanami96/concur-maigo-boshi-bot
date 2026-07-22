import { describe, it, expect } from "vitest";
import { resolveAuthGateView } from "../src/admin/authGateStatus";

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
