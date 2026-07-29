import { describe, it, expect } from "vitest";
import { resolveConcurOAuthConfig } from "../supabase/functions/create-concur-quick-expense/resolveConcurOAuthConfig.js";

// 以下の値はすべてテスト専用のダミー値であり、実際のConcur側の
// 認証情報ではない。

function buildValidEnv(overrides = {}) {
  return {
    CONCUR_CLIENT_ID: "dummy-client-id",
    CONCUR_CLIENT_SECRET: "dummy-client-secret",
    CONCUR_REFRESH_TOKEN: "dummy-refresh-token",
    CONCUR_TOKEN_URL: "https://example-dummy.concursolutions.test/oauth2/v0/token",
    ...overrides,
  };
}

describe("resolveConcurOAuthConfig", () => {
  it("必須Secretsが全てあればok:trueで値を返す", () => {
    const result = resolveConcurOAuthConfig(buildValidEnv());

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      clientId: "dummy-client-id",
      clientSecret: "dummy-client-secret",
      refreshToken: "dummy-refresh-token",
      tokenUrl: "https://example-dummy.concursolutions.test/oauth2/v0/token",
    });
  });

  it("任意のCONCUR_SCOPEが無くても成立する（scopeキー自体が付かない）", () => {
    const result = resolveConcurOAuthConfig(buildValidEnv());

    expect(result.ok).toBe(true);
    expect(result.config).not.toHaveProperty("scope");
  });

  it("CONCUR_SCOPEがあればconfig.scopeに含まれる", () => {
    const result = resolveConcurOAuthConfig(buildValidEnv({ CONCUR_SCOPE: "dummy.scope" }));

    expect(result.ok).toBe(true);
    expect(result.config.scope).toBe("dummy.scope");
  });

  it("CONCUR_CLIENT_IDが無い場合はok:falseでmissingに含まれる", () => {
    const env = buildValidEnv();
    delete env.CONCUR_CLIENT_ID;

    const result = resolveConcurOAuthConfig(env);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("CONCUR_CLIENT_ID");
  });

  it("CONCUR_CLIENT_SECRETが無い場合はok:falseでmissingに含まれる", () => {
    const env = buildValidEnv();
    delete env.CONCUR_CLIENT_SECRET;

    const result = resolveConcurOAuthConfig(env);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("CONCUR_CLIENT_SECRET");
  });

  it("CONCUR_REFRESH_TOKENが無い場合はok:falseでmissingに含まれる", () => {
    const env = buildValidEnv();
    delete env.CONCUR_REFRESH_TOKEN;

    const result = resolveConcurOAuthConfig(env);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("CONCUR_REFRESH_TOKEN");
  });

  it("CONCUR_TOKEN_URLが無い場合はok:falseでmissingに含まれる（既定URLへフォールバックしない）", () => {
    const env = buildValidEnv();
    delete env.CONCUR_TOKEN_URL;

    const result = resolveConcurOAuthConfig(env);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("CONCUR_TOKEN_URL");
    // フォールバックURLを推測して埋めていないこと（configキー自体が無い）。
    expect(result).not.toHaveProperty("config");
  });

  it("複数のSecretsが同時に不足している場合、全てmissingに列挙される", () => {
    const result = resolveConcurOAuthConfig({});

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "CONCUR_CLIENT_ID",
        "CONCUR_CLIENT_SECRET",
        "CONCUR_REFRESH_TOKEN",
        "CONCUR_TOKEN_URL",
      ]),
    );
  });

  it("空文字・空白のみの値は未設定として扱う", () => {
    const result = resolveConcurOAuthConfig(buildValidEnv({ CONCUR_CLIENT_ID: "   " }));

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("CONCUR_CLIENT_ID");
  });

  it("envがundefinedでも例外にならない", () => {
    const result = resolveConcurOAuthConfig(undefined);

    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("CONCUR_TOKEN_URLがURLとして解釈できない文字列の場合はok:false（missingへCONCUR_TOKEN_URLを含む）", () => {
    const result = resolveConcurOAuthConfig(buildValidEnv({ CONCUR_TOKEN_URL: "not-a-url" }));

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("CONCUR_TOKEN_URL");
  });

  it("CONCUR_TOKEN_URLがhttp（非暗号化）の場合はok:false（httpsのみ許可）", () => {
    const result = resolveConcurOAuthConfig(
      buildValidEnv({ CONCUR_TOKEN_URL: "http://example-dummy.concursolutions.test/oauth2/v0/token" }),
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("CONCUR_TOKEN_URL");
  });

  it("CONCUR_TOKEN_URLがhttpsの場合は正常に受理する", () => {
    const result = resolveConcurOAuthConfig(
      buildValidEnv({ CONCUR_TOKEN_URL: "https://example-dummy.concursolutions.test/oauth2/v0/token" }),
    );

    expect(result.ok).toBe(true);
    expect(result.config.tokenUrl).toBe("https://example-dummy.concursolutions.test/oauth2/v0/token");
  });
});
