import { describe, it, expect } from "vitest";
import { buildSafeConcurPrincipalTypeDiagnosticLog } from "../supabase/functions/_shared/concur-identity/buildSafeConcurPrincipalTypeDiagnosticLog.js";

// JWTのpayloadをBase64URLエンコードして、テスト専用のダミーJWTを組み立てる。
// 署名は検証されないため、テストでは常にダミー文字列で構わない。
function base64UrlEncode(value) {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildFakeIdToken(payload, { header = { alg: "RS256", typ: "JWT" }, signature = "dummy-signature" } = {}) {
  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}.${signature}`;
}

describe("buildSafeConcurPrincipalTypeDiagnosticLog（正常系）", () => {
  it("concur.typeクレームがある場合、安全化した値を返す", () => {
    const idToken = buildFakeIdToken({ "concur.type": "user", sub: "some-uuid" });
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });

    expect(result).toEqual({
      stage: "concur_principal_type_diagnostic",
      idTokenPresent: true,
      payloadParsed: true,
      concurTypePresent: true,
      concurType: "user",
    });
  });

  it("claim名にハイフン・アンダースコアを含む値も安全な範囲でそのまま返す", () => {
    const idToken = buildFakeIdToken({ "concur.type": "company-level_v1" });
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });
    expect(result.concurType).toBe("company-level_v1");
    expect(result.concurTypePresent).toBe(true);
  });
});

describe("buildSafeConcurPrincipalTypeDiagnosticLog（claim欠落・id_token欠落）", () => {
  it("concur.typeクレームが無い場合、concurTypePresent:false・concurType:unknown", () => {
    const idToken = buildFakeIdToken({ sub: "some-uuid" });
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });

    expect(result.idTokenPresent).toBe(true);
    expect(result.payloadParsed).toBe(true);
    expect(result.concurTypePresent).toBe(false);
    expect(result.concurType).toBe("unknown");
  });

  it("id_tokenが無い（null/undefined）場合、idTokenPresent:falseで安全に扱う", () => {
    expect(buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: null })).toEqual({
      stage: "concur_principal_type_diagnostic",
      idTokenPresent: false,
      payloadParsed: false,
      concurTypePresent: false,
      concurType: "unknown",
    });
    expect(buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: undefined }).idTokenPresent).toBe(false);
  });

  it("id_tokenが空文字・空白のみの場合もidTokenPresent:false", () => {
    expect(buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: "" }).idTokenPresent).toBe(false);
    expect(buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: "   " }).idTokenPresent).toBe(false);
  });
});

describe("buildSafeConcurPrincipalTypeDiagnosticLog（JWT形式・デコード異常系）", () => {
  it("JWT形式でない（ドット区切りが無い）文字列はpayloadParsed:false", () => {
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: "not-a-jwt-at-all" });
    expect(result.idTokenPresent).toBe(true);
    expect(result.payloadParsed).toBe(false);
    expect(result.concurTypePresent).toBe(false);
    expect(result.concurType).toBe("unknown");
  });

  it("Base64URLとして不正な文字列はpayloadParsed:false（例外にならない）", () => {
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: "header.!!!not-valid-base64!!!.sig" });
    expect(result.payloadParsed).toBe(false);
    expect(result.concurType).toBe("unknown");
  });

  it("デコード結果がJSONでない場合はpayloadParsed:false（例外にならない）", () => {
    const notJsonPayload = base64UrlEncode("this is not json at all");
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: `header.${notJsonPayload}.sig` });
    expect(result.payloadParsed).toBe(false);
    expect(result.concurType).toBe("unknown");
  });

  it("デコード結果が配列の場合もpayloadParsed:false", () => {
    const arrayPayload = base64UrlEncode(JSON.stringify([1, 2, 3]));
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: `header.${arrayPayload}.sig` });
    expect(result.payloadParsed).toBe(false);
  });
});

describe("buildSafeConcurPrincipalTypeDiagnosticLog（concur.typeのサニタイズ）", () => {
  it("concur.typeが非文字列の場合はunknown", () => {
    const idToken = buildFakeIdToken({ "concur.type": 12345 });
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });
    expect(result.concurTypePresent).toBe(false);
    expect(result.concurType).toBe("unknown");
  });

  it("50文字を超える値はunknownへ丸める", () => {
    const idToken = buildFakeIdToken({ "concur.type": "a".repeat(51) });
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });
    expect(result.concurTypePresent).toBe(false);
    expect(result.concurType).toBe("unknown");
  });

  it("制御文字・空白・記号を含む値はunknownへ丸める（英数字・ハイフン・アンダースコアのみ許可）", () => {
    const dangerous = ["user type", "user;drop table", "user\ntype", "user<script>", "user@example.com"];
    for (const value of dangerous) {
      const idToken = buildFakeIdToken({ "concur.type": value });
      const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });
      expect(result.concurTypePresent).toBe(false);
      expect(result.concurType).toBe("unknown");
    }
  });

  it("空文字・空白のみのconcur.typeはunknown", () => {
    const idToken = buildFakeIdToken({ "concur.type": "   " });
    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });
    expect(result.concurTypePresent).toBe(false);
    expect(result.concurType).toBe("unknown");
  });
});

describe("buildSafeConcurPrincipalTypeDiagnosticLog（非露出の確認）", () => {
  it("id_token全体・他のclaim（sub・email等）がログへ一切含まれない", () => {
    const idToken = buildFakeIdToken({
      "concur.type": "company",
      sub: "SECRET_SUBJECT_UUID_SHOULD_NOT_LEAK",
      "concur.profile": "https://us.api.concursolutions.com/profile/v1/principals/SECRET_SHOULD_NOT_LEAK",
      email: "should-not-leak@example.com",
    });

    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(idToken);
    expect(serialized).not.toContain("SECRET_SUBJECT_UUID_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("should-not-leak@example.com");
    expect(serialized).not.toContain("concur.profile");
    expect(Object.keys(result).sort()).toEqual(
      ["stage", "idTokenPresent", "payloadParsed", "concurTypePresent", "concurType"].sort(),
    );
    expect(result.concurType).toBe("company");
  });

  it("Access Token・Refresh Token・Client Secretはこの関数の入出力に一切関係しない", () => {
    const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
    const DUMMY_REFRESH_TOKEN = "DUMMY_REFRESH_TOKEN_SHOULD_NOT_LEAK";
    const DUMMY_CLIENT_SECRET = "DUMMY_CLIENT_SECRET_SHOULD_NOT_LEAK";
    const idToken = buildFakeIdToken({ "concur.type": "user" });

    const result = buildSafeConcurPrincipalTypeDiagnosticLog({ idToken });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(serialized).not.toContain(DUMMY_REFRESH_TOKEN);
    expect(serialized).not.toContain(DUMMY_CLIENT_SECRET);
  });

  it("例外を投げない（あらゆる異常な入力に対しても常にオブジェクトを返す）", () => {
    expect(() => buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: 12345 })).not.toThrow();
    expect(() => buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: {} })).not.toThrow();
    expect(() => buildSafeConcurPrincipalTypeDiagnosticLog({ idToken: "a.b" })).not.toThrow();
    expect(() => buildSafeConcurPrincipalTypeDiagnosticLog({})).not.toThrow();
  });
});
