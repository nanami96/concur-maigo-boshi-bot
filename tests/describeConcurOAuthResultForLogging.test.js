import { describe, it, expect } from "vitest";
import { describeConcurOAuthResultForLogging } from "../supabase/functions/_shared/concur-oauth/describeConcurOAuthResultForLogging.js";

// 以下のトークン値はすべてテスト専用のダミー値であり、実際のConcur側の
// トークンではない。

describe("describeConcurOAuthResultForLogging", () => {
  it("全項目が揃っている場合は全てtrue", () => {
    const summary = describeConcurOAuthResultForLogging({
      accessToken: "dummy-access-token",
      refreshToken: "dummy-refresh-token",
      geolocation: "https://example-dummy.concursolutions.test",
      scope: "dummy.scope",
      expiresIn: 3600,
    });

    expect(summary).toEqual({
      hasAccessToken: true,
      hasRefreshToken: true,
      hasGeolocation: true,
      hasScope: true,
      expiresInPresent: true,
    });
  });

  it("refresh_token・scope・geolocation・expires_inが無い場合はそれぞれfalse", () => {
    const summary = describeConcurOAuthResultForLogging({
      accessToken: "dummy-access-token",
      refreshToken: null,
      geolocation: null,
      scope: null,
      expiresIn: null,
    });

    expect(summary).toEqual({
      hasAccessToken: true,
      hasRefreshToken: false,
      hasGeolocation: false,
      hasScope: false,
      expiresInPresent: false,
    });
  });

  it("tokensがnull・undefinedでも例外にならず全てfalse", () => {
    expect(describeConcurOAuthResultForLogging(null)).toEqual({
      hasAccessToken: false,
      hasRefreshToken: false,
      hasGeolocation: false,
      hasScope: false,
      expiresInPresent: false,
    });
    expect(describeConcurOAuthResultForLogging(undefined)).toEqual({
      hasAccessToken: false,
      hasRefreshToken: false,
      hasGeolocation: false,
      hasScope: false,
      expiresInPresent: false,
    });
  });

  it("戻り値（要約）に実際のトークン値・文字列が一切含まれない", () => {
    const accessTokenValue = "SHOULD_NOT_LEAK_ACCESS_TOKEN";
    const refreshTokenValue = "SHOULD_NOT_LEAK_REFRESH_TOKEN";

    const summary = describeConcurOAuthResultForLogging({
      accessToken: accessTokenValue,
      refreshToken: refreshTokenValue,
      geolocation: "SHOULD_NOT_LEAK_GEOLOCATION",
      scope: "SHOULD_NOT_LEAK_SCOPE",
      expiresIn: 3600,
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(accessTokenValue);
    expect(serialized).not.toContain(refreshTokenValue);
    expect(serialized).not.toContain("SHOULD_NOT_LEAK_GEOLOCATION");
    expect(serialized).not.toContain("SHOULD_NOT_LEAK_SCOPE");
    // 値は全て真偽値だけであること。
    Object.values(summary).forEach((value) => expect(typeof value).toBe("boolean"));
  });
});
