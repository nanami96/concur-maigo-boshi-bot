import { describe, it, expect } from "vitest";
import { buildSafeIdentityRejectedDebugLog } from "../supabase/functions/_shared/concur-identity/buildSafeIdentityRejectedDebugLog.js";

function headersFrom(map) {
  return { get: (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null) };
}

describe("buildSafeIdentityRejectedDebugLog（正常系：error/error_descriptionの抽出）", () => {
  it("JSON本文からerror・error_descriptionを安全に抽出する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 403,
      bodyText: JSON.stringify({ error: "insufficient_scope", error_description: "The token does not have the required scope." }),
    });

    expect(result).toEqual({
      stage: "identity_rejected",
      status: 403,
      error: "insufficient_scope",
      errorDescription: "The token does not have the required scope.",
      responseJsonParsed: true,
      requestIdPresent: false,
      requestId: null,
    });
  });

  it("error_descriptionが無い場合はnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "invalid_token" }) });
    expect(result.error).toBe("invalid_token");
    expect(result.errorDescription).toBeNull();
  });

  it("errorが無い場合はnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error_description: "expired" }) });
    expect(result.error).toBeNull();
    expect(result.errorDescription).toBe("expired");
  });

  it("code・errorCode等、error/error_description以外のフィールド名は抽出しない", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ code: "invalid_token", errorCode: "invalid_token" }),
    });
    expect(result.error).toBeNull();
    expect(result.errorDescription).toBeNull();
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
  it("JSONとして解析できない本文はresponseJsonParsed:false、error/errorDescription:nullで、本文自体を含まない", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: "<html>not json</html>" });

    expect(result.responseJsonParsed).toBe(false);
    expect(result.error).toBeNull();
    expect(result.errorDescription).toBeNull();
    expect(JSON.stringify(result)).not.toContain("not json");
  });

  it("bodyTextが未指定（読み取り失敗）の場合もresponseJsonParsed:falseで安全に扱う", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: undefined });

    expect(result.responseJsonParsed).toBe(false);
    expect(result.error).toBeNull();
    expect(result.errorDescription).toBeNull();
  });

  it("空文字の本文もresponseJsonParsed:false", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: "   " });
    expect(result.responseJsonParsed).toBe(false);
  });

  it("配列そのもの等、想定外の構造はerror/errorDescriptionともnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify([1, 2, 3]) });
    expect(result.error).toBeNull();
    expect(result.errorDescription).toBeNull();
  });
});

describe("buildSafeIdentityRejectedDebugLog（errorのサニタイズ）", () => {
  it("非文字列のerrorはnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: 12345 }) });
    expect(result.error).toBeNull();
  });

  it("100文字を超えるerrorはnullへ丸める", () => {
    const longValue = "a".repeat(101);
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: longValue }) });
    expect(result.error).toBeNull();
  });

  it("制御文字・改行を含むerrorは安全化される", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error: "invalid\ntoken\r\n\x00value" }),
    });
    expect(result.error).toBe("invalidtokenvalue");
  });

  it("メールアドレスらしい値はnullへ丸める", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "user@example.com" }) });
    expect(result.error).toBeNull();
  });

  it("JWTらしい値（ドット区切り3セグメント）はnullへ丸める", () => {
    const jwtLike = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: jwtLike }) });
    expect(result.error).toBeNull();
  });

  it("長いトークンらしい値（40文字超のトークン文字集合）はnullへ丸める", () => {
    const tokenLike = "A".repeat(50);
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: tokenLike }) });
    expect(result.error).toBeNull();
  });

  it("空文字・空白のみのerrorはnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "   " }) });
    expect(result.error).toBeNull();
  });

  it("短い定型的なOAuthエラーコードはそのまま通す", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "invalid_token" }) });
    expect(result.error).toBe("invalid_token");
  });
});

describe("buildSafeIdentityRejectedDebugLog（error_descriptionのサニタイズ）", () => {
  it("非文字列のerror_descriptionはnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error_description: { nested: true } }) });
    expect(result.errorDescription).toBeNull();
  });

  it("空文字・空白のみのerror_descriptionはnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error_description: "   " }) });
    expect(result.errorDescription).toBeNull();
  });

  it("制御文字・改行を除去する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error_description: "token\nexpired\r\n\x00now" }),
    });
    expect(result.errorDescription).toBe("tokenexpirednow");
  });

  it("200文字を超える場合は切り詰めて末尾に…を付与する", () => {
    // トークンらしい連続文字列としてredactされないよう、スペース区切りの
    // 通常の英文らしい形にする（各単語は24文字未満）。
    const longValue = "word ".repeat(60).trim();
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error_description: longValue }) });
    expect(result.errorDescription.length).toBe(201);
    expect(result.errorDescription.endsWith("…")).toBe(true);
  });

  it("埋め込まれたメールアドレスを[redacted-email]へ置換する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error_description: "token expired for taro.yamada@example.com" }),
    });
    expect(result.errorDescription).toBe("token expired for [redacted-email]");
    expect(result.errorDescription).not.toContain("@");
  });

  it("埋め込まれたUUID（userIDの形式）を[redacted-id]へ置換する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error_description: "no user found with id 3df11695-e8bb-40ff-8e98-c85913ab2789" }),
    });
    expect(result.errorDescription).toBe("no user found with id [redacted-id]");
  });

  it("埋め込まれた長いトークンらしい文字列を[redacted-token]へ置換する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error_description: "invalid token: DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK" }),
    });
    expect(result.errorDescription).toBe("invalid token: [redacted-token]");
    expect(result.errorDescription).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
  });

  it("文字列全体が長いトークンらしい場合は丸ごと[redacted-token]に置換される", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error_description: "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK_1234567890" }),
    });
    expect(result.errorDescription).toBe("[redacted-token]");
  });

  it("通常の短い説明文はそのまま通す", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error_description: "The access token expired" }),
    });
    expect(result.errorDescription).toBe("The access token expired");
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
  it("message・userName・メールアドレス・userID・Access Token等が結果に一切含まれない", () => {
    const dangerousBody = {
      error: "invalid_token",
      error_description: "The access token abcdefgh-secret expired for user taro.yamada@example.com (id 3df11695-e8bb-40ff-8e98-c85913ab2789)",
      message: "Authorization header was DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK",
      userName: "taro.yamada@example.com",
      scope: "identity.user.ids.read some.other.scope",
    };

    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify(dangerousBody) });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("taro.yamada@example.com");
    expect(serialized).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("3df11695-e8bb-40ff-8e98-c85913ab2789");
    expect(serialized).not.toContain("identity.user.ids.read");
    expect(result.error).toBe("invalid_token");
    expect(result.errorDescription).not.toContain("@");
    expect(result.errorDescription).not.toContain("3df11695-e8bb-40ff-8e98-c85913ab2789");
  });
});
