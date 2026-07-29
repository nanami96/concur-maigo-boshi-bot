import { describe, it, expect } from "vitest";
import { buildSafeIdentityRejectedDebugLog } from "../supabase/functions/_shared/concur-identity/buildSafeIdentityRejectedDebugLog.js";

function headersFrom(map) {
  return { get: (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null) };
}

describe("buildSafeIdentityRejectedDebugLog（正常系）", () => {
  it("JSON本文からerrorCode候補を安全に抽出する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 403,
      bodyText: JSON.stringify({ error: "insufficient_scope" }),
    });

    expect(result).toEqual({
      stage: "identity_rejected",
      status: 403,
      errorCode: "insufficient_scope",
      responseJsonParsed: true,
      requestIdPresent: false,
      requestId: null,
    });
  });

  it("candidate優先順位: error → code → errorCode", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ code: "invalid_token", errorCode: "should_not_be_used" }),
    });
    expect(result.errorCode).toBe("invalid_token");
  });

  it("request ID系ヘッダーが存在する場合、requestIdPresentとrequestIdを返す", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: "{}",
      headers: headersFrom({ "x-request-id": "abc-123" }),
    });

    expect(result.requestIdPresent).toBe(true);
    expect(result.requestId).toBe("abc-123");
  });

  it("correlation-id / x-correlation-idも候補として確認する", () => {
    const result1 = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: "{}",
      headers: headersFrom({ "correlation-id": "cid-1" }),
    });
    expect(result1.requestId).toBe("cid-1");

    const result2 = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: "{}",
      headers: headersFrom({ "x-correlation-id": "cid-2" }),
    });
    expect(result2.requestId).toBe("cid-2");
  });
});

describe("buildSafeIdentityRejectedDebugLog（本文がJSONでない・欠落）", () => {
  it("JSONとして解析できない本文はresponseJsonParsed:false、errorCode:unknownで、本文自体を含まない", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: "<html>not json</html>" });

    expect(result.responseJsonParsed).toBe(false);
    expect(result.errorCode).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("not json");
  });

  it("bodyTextが未指定（読み取り失敗）の場合もresponseJsonParsed:false・errorCode:unknownで安全に扱う", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: undefined });

    expect(result.responseJsonParsed).toBe(false);
    expect(result.errorCode).toBe("unknown");
  });

  it("空文字の本文もresponseJsonParsed:false", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: "   " });
    expect(result.responseJsonParsed).toBe(false);
    expect(result.errorCode).toBe("unknown");
  });

  it("Resources配列など想定外の構造（配列そのもの）はerrorCode:unknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify([1, 2, 3]) });
    expect(result.errorCode).toBe("unknown");
  });

  it("errorCode候補フィールドが無い場合はunknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ message: "invalid_token", error_description: "detail" }) });
    expect(result.errorCode).toBe("unknown");
  });
});

describe("buildSafeIdentityRejectedDebugLog（errorCodeのサニタイズ）", () => {
  it("非文字列のerrorCode候補はunknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: 12345 }) });
    expect(result.errorCode).toBe("unknown");
  });

  it("100文字を超えるerrorCodeはunknownへ丸める", () => {
    const longValue = "a".repeat(101);
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: longValue }) });
    expect(result.errorCode).toBe("unknown");
  });

  it("制御文字・改行を含むerrorCodeは安全化される", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error: "invalid\ntoken\r\n\x00value" }),
    });
    expect(result.errorCode).toBe("invalidtokenvalue");
  });

  it("メールアドレスらしい値はunknownへ丸める", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "user@example.com" }) });
    expect(result.errorCode).toBe("unknown");
  });

  it("JWTらしい値（ドット区切り3セグメント）はunknownへ丸める", () => {
    const jwtLike = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: jwtLike }) });
    expect(result.errorCode).toBe("unknown");
  });

  it("長いトークンらしい値（40文字超のトークン文字集合）はunknownへ丸める", () => {
    const tokenLike = "A".repeat(50);
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: tokenLike }) });
    expect(result.errorCode).toBe("unknown");
  });

  it("空文字・空白のみのerrorCodeはunknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "   " }) });
    expect(result.errorCode).toBe("unknown");
  });

  it("短い定型的なOAuthエラーコードはそのまま通す", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "invalid_token" }) });
    expect(result.errorCode).toBe("invalid_token");
  });
});

describe("buildSafeIdentityRejectedDebugLog（requestIdのサニタイズ）", () => {
  it("安全でない文字（記号・空白等）を含むヘッダー値はrequestId:nullだがrequestIdPresent:trueとする", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: "{}",
      headers: headersFrom({ "x-request-id": "abc 123!?" }),
    });
    expect(result.requestIdPresent).toBe(true);
    expect(result.requestId).toBeNull();
  });

  it("100文字を超えるヘッダー値はrequestId:null", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: "{}",
      headers: headersFrom({ "x-request-id": "a".repeat(101) }),
    });
    expect(result.requestId).toBeNull();
  });

  it("該当するヘッダーが無い場合はrequestIdPresent:false・requestId:null", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: "{}", headers: headersFrom({}) });
    expect(result.requestIdPresent).toBe(false);
    expect(result.requestId).toBeNull();
  });

  it("headers自体が未指定でも例外にならない", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: "{}" });
    expect(result.requestIdPresent).toBe(false);
    expect(result.requestId).toBeNull();
  });
});

describe("buildSafeIdentityRejectedDebugLog（非露出の確認）", () => {
  it("error_description・message・userName・メールアドレス・userID・Access Token等が結果に一切含まれない", () => {
    const dangerousBody = {
      error: "invalid_token",
      error_description: "The access token abcdefgh-secret expired for user taro.yamada@example.com (id 3df11695-e8bb-40ff-8e98-c85913ab2789)",
      message: "Authorization header was DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK",
      userName: "taro.yamada@example.com",
      scope: "identity.user.ids.read some.other.scope",
    };

    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify(dangerousBody) });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("error_description");
    expect(serialized).not.toContain("taro.yamada@example.com");
    expect(serialized).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("3df11695-e8bb-40ff-8e98-c85913ab2789");
    expect(serialized).not.toContain("identity.user.ids.read");
    expect(result.errorCode).toBe("invalid_token");
  });
});
