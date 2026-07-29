import { describe, it, expect } from "vitest";
import { validateConcurTokenResponse } from "../supabase/functions/_shared/concur-oauth/validateConcurTokenResponse.js";

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
      idToken: null,
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
      idToken: null,
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

// 【一時的なデバッグログ・要削除】id_token（OIDCのJWT）の検証テスト。
// concur_principal_type_diagnostic（401原因切り分け用の一時診断）でだけ
// 使う想定で、access_token等の既存検証には影響しない。
describe("validateConcurTokenResponse（id_token）", () => {
  it("id_tokenがある場合、tokens.idTokenへそのまま保持する", () => {
    const result = validateConcurTokenResponse({
      access_token: "dummy-access-token",
      id_token: "dummy.jwt.token",
    });

    expect(result.ok).toBe(true);
    expect(result.tokens.idToken).toBe("dummy.jwt.token");
  });

  it("id_tokenが無い場合はidToken:null（既存の検証は壊れない）", () => {
    const result = validateConcurTokenResponse({ access_token: "dummy-access-token" });

    expect(result.ok).toBe(true);
    expect(result.tokens.idToken).toBeNull();
  });

  it("id_tokenが空文字・空白のみの場合はidToken:null（応答全体は拒否しない）", () => {
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", id_token: "" }).tokens.idToken).toBeNull();
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", id_token: "   " }).tokens.idToken).toBeNull();
  });

  it("id_tokenが文字列以外の型の場合はok:false（他の任意項目と同じ厳格さ）", () => {
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", id_token: 123 }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", id_token: {} }).ok).toBe(false);
    expect(validateConcurTokenResponse({ access_token: "dummy-access-token", id_token: [] }).ok).toBe(false);
  });

  it("id_tokenの有無にかかわらず、access_token等の既存検証結果は変わらない", () => {
    const withoutIdToken = validateConcurTokenResponse({ access_token: "dummy-access-token", scope: "dummy.scope" });
    const withIdToken = validateConcurTokenResponse({ access_token: "dummy-access-token", scope: "dummy.scope", id_token: "dummy.jwt.token" });

    expect(withoutIdToken.tokens.accessToken).toBe(withIdToken.tokens.accessToken);
    expect(withoutIdToken.tokens.scope).toBe(withIdToken.tokens.scope);
  });

  it("id_tokenはログ・エラーへ一切含まれない（この関数の戻り値の範囲では、指定した名前のキー以外に漏れない）", () => {
    const result = validateConcurTokenResponse({ access_token: "dummy-access-token", id_token: "DUMMY_ID_TOKEN_SHOULD_ONLY_BE_IN_IDTOKEN_FIELD" });

    expect(Object.keys(result.tokens).sort()).toEqual(
      ["accessToken", "refreshToken", "tokenType", "expiresIn", "scope", "geolocation", "idToken"].sort(),
    );
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
