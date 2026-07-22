import { describe, it, expect } from "vitest";
import { resolveBotConfigSource } from "../src/resolveBotConfigSource";

const staticConfig = { questions: [], rules: [] };
const remoteConfig = { questions: [{ id: "Q001" }], rules: [] };

describe("resolveBotConfigSource", () => {
  it("Supabase未設定・静的configありならstaticを使う", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: false,
      isPublicDemo: false,
      staticConfig,
      remoteConfig: null,
      remoteError: null,
    });
    expect(result).toEqual({ status: "ready", config: staticConfig, source: "static" });
  });

  it("Supabase未設定・静的configも無ければunavailable", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: false,
      isPublicDemo: false,
      staticConfig: null,
      remoteConfig: null,
      remoteError: null,
    });
    expect(result).toEqual({ status: "unavailable", config: null, source: null });
  });

  it("Supabaseに公開済み設定があれば最優先でremoteを使う（静的configがあっても）", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: true,
      isPublicDemo: false,
      staticConfig,
      remoteConfig,
      remoteError: null,
    });
    expect(result).toEqual({ status: "ready", config: remoteConfig, source: "remote" });
  });

  it("Supabase接続は成功したが未公開（エラー無し）→静的configへフォールバック", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: true,
      isPublicDemo: false,
      staticConfig,
      remoteConfig: null,
      remoteError: null,
    });
    expect(result).toEqual({ status: "ready", config: staticConfig, source: "static-unpublished" });
  });

  it("未公開・静的configも無ければunavailable", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: true,
      isPublicDemo: false,
      staticConfig: null,
      remoteConfig: null,
      remoteError: null,
    });
    expect(result).toEqual({ status: "unavailable", config: null, source: null });
  });

  it("取得失敗・ローカル開発（isPublicDemo=false）→静的configへフォールバック", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: true,
      isPublicDemo: false,
      staticConfig,
      remoteConfig: null,
      remoteError: { type: "network", message: "offline" },
    });
    expect(result).toEqual({ status: "ready", config: staticConfig, source: "static-fallback" });
  });

  it("取得失敗・本番相当ビルド（isPublicDemo=true）→静的configへは戻さずerror", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: true,
      isPublicDemo: true,
      staticConfig,
      remoteConfig: null,
      remoteError: { type: "network", message: "offline" },
    });
    expect(result).toEqual({ status: "error", config: null, source: null });
  });

  it("取得失敗・静的configも無ければ（isPublicDemoに関わらず）error", () => {
    const result = resolveBotConfigSource({
      isSupabaseConfigured: true,
      isPublicDemo: false,
      staticConfig: null,
      remoteConfig: null,
      remoteError: { type: "unknown", message: "boom" },
    });
    expect(result).toEqual({ status: "error", config: null, source: null });
  });
});
