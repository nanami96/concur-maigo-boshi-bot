import { describe, it, expect } from "vitest";
import { validateConcurTokenResponse } from "../supabase/functions/create-concur-quick-expense/validateConcurTokenResponse.js";

// 以下のトークン値はすべてテスト専用のダミー値であり、実際のConcur側の
// トークンではない。

describe("validateConcurTokenResponse（正常系）", () => {
  it("access_tokenのみでも正常（他は全て任意項目）", () => {
    const result = validateConcurTokenResponse({ access_token: "dummy-access-token" });

    expect(result.ok).toBe(true);
    expect(result.tokens).toEqual({
      accessToken: "dummy-access-token",
      refreshToken: null,
      tokenType: null,
      expiresIn: null,
      scope: null,
      geolocation: null,
    });
  });

  it("access_token・expires_in（数値）・geolocation・新しいrefresh_tokenが揃っている場合", () => {
    const result = validateConcurTokenResponse({
      access_token: "dummy-access-token",
      refresh_token: "dummy-new-refresh-token",
      expires_in: 3600,
      geolocation: "https://example-dummy.concursolutions.test",
      token_type: "Bearer",
      scope: "dummy.scope",
    });

    expect(result.ok).toBe(true);
    expect(result.tokens).toEqual({
      accessToken: "dummy-access-token",
      refreshToken: "dummy-new-refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: "dummy.scope",
      geolocation: "https://example-dummy.concursolutions.test",
    });
  });

  it("expires_inが数値文字列（例:\"3600\"）の場合も正常として数値化する（Concur公式サンプルの実際の形式）", () => {
    const result = validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: "3600" });

    expect(result.ok).toBe(true);
    expect(result.tokens.expiresIn).toBe(3600);
  });

  it("refresh_tokenが返らない場合も正常（refreshToken: null）", () => {
    const result = validateConcurTokenResponse({ access_token: "dummy-access-token" });

    expect(result.ok).toBe(true);
    expect(result.tokens.refreshToken).toBeNull();
  });

  it("scopeが無い場合も正常（scope: null）", () => {
    const result = validateConcurTokenResponse({ access_token: "dummy-access-token" });

    expect(result.ok).toBe(true);
    expect(result.tokens.scope).toBeNull();
  });
});

describe("validateConcurTokenResponse（異常系）", () => {
  it("access_tokenが無い場合はok:false", () => {
    expect(validateConcurTokenResponse({ expires_in: 3600 }).ok).toBe(false);
  });

  it("access_tokenが空文字の場合はok:false", () => {
    expect(validateConcurTokenResponse({ access_token: "" }).ok).toBe(false);
  });

  it("access_tokenが文字列でない場合（型不正）はok:false", () => {
    expect(validateConcurTokenResponse({ access_token: 12345 }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: null }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: { value: "dummy" } }).ok).toBe(false);
  });

  it("expires_inが妥当な数値・数値文字列でない場合はok:false", () => {
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: "not-a-number" }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: -100 }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: {} }).ok).toBe(false);
  });

  it("expires_inは正の有限数だけを有効とする：0・負数・NaN・Infinityは全て拒否する", () => {
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: 0 }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: "0" }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: -1 }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: Number.NaN }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", expires_in: "Infinity" }).ok).toBe(false);
  });

  it("token_typeが空文字の場合はok:false（未設定と同じ扱いにはしない）", () => {
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", token_type: "" }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", token_type: "   " }).ok).toBe(false);
  });

  it("token_typeが文字列以外の型の場合はok:false", () => {
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", token_type: 123 }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", token_type: null }).ok).toBe(false);
  });

  it("refresh_tokenが空文字・型不正の場合はok:false", () => {
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", refresh_token: "" }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", refresh_token: 123 }).ok).toBe(false);
  });

  it("bodyがnull・配列・非オブジェクトの場合はok:false（例外にならない）", () => {
    expect(validateConcurTokenResponse(null).ok).toBe(false);
    expect(validateConcurTokenResponse(undefined).ok).toBe(false);
    expect(validateConcurTokenResponse([]).ok).toBe(false);
    expect(validateConcurTokenResponse("not-an-object").ok).toBe(false);
  });
});
