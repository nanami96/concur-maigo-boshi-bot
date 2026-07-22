import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

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

describe("supabaseClient: detectSessionInUrlはfalseで固定されている（実Supabase回帰テスト）", () => {
  // detectSessionInUrl:trueの自動処理は失敗を呼び出し元へ伝播しないため、実Supabase
  // 環境で「確認メールのリンクをクリックしてもセッションが確立されない」不具合の
  // 原因になっていた。認証コールバックの処理はAuthGate.jsx/AppAuthGate.jsxが
  // exchangeAuthCallback()を介して明示的に行う設計にしたため、この関数はfalseの
  // ままでなければならない（trueに戻すと、暗黙処理と明示処理が同じ使い捨てcodeを
  // 奪い合うレースが再発する）。
  it("createClientへdetectSessionInUrl: falseが渡されている", () => {
    const sourceRaw = fs.readFileSync(
      path.resolve(__dirname, "../src/lib/supabaseClient.js"),
      "utf8",
    );
    // コメント中の説明文（旧仕様との比較説明等）に惑わされないよう、
    // 実コードだけを対象にする（schema.sql系テストと同じ方針）。
    const source = sourceRaw
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

    expect(source).toMatch(/detectSessionInUrl:\s*false/);
    expect(source).not.toMatch(/detectSessionInUrl:\s*true/);
  });
});
