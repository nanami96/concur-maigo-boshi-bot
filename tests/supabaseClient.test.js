import { describe, it, expect, beforeEach, vi } from "vitest";

// supabaseClient.js はモジュール読み込み時に import.meta.env を1回だけ評価するため、
// 「未設定」「設定済み」の両方を検証するには、環境変数をスタブしてから
// vi.resetModules() でモジュールキャッシュを破棄し、都度 動的import し直す必要がある。
describe("supabaseClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("URL・anon keyが両方とも空の場合、isSupabaseConfigured=false かつ supabase=null になる", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const mod = await import("../src/lib/supabaseClient.js");

    expect(mod.isSupabaseConfigured).toBe(false);
    expect(mod.supabase).toBeNull();
  });

  it("URLだけ設定されていて anon keyが無い場合も未設定として扱われる", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const mod = await import("../src/lib/supabaseClient.js");

    expect(mod.isSupabaseConfigured).toBe(false);
    expect(mod.supabase).toBeNull();
  });

  it("URL・anon keyの両方が設定されている場合、isSupabaseConfigured=true になりクライアントが生成される", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "dummy-anon-key-for-test");

    const mod = await import("../src/lib/supabaseClient.js");

    expect(mod.isSupabaseConfigured).toBe(true);
    expect(mod.supabase).not.toBeNull();
    expect(typeof mod.supabase.auth.getSession).toBe("function");
  });
});
