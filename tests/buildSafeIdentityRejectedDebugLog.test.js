import { describe, it, expect } from "vitest";
import { buildSafeIdentityRejectedDebugLog } from "../supabase/functions/_shared/concur-identity/buildSafeIdentityRejectedDebugLog.js";

function headersFrom(map) {
  return { get: (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null) };
}

describe("buildSafeIdentityRejectedDebugLog（errorSchema判定）", () => {
  it("scimType/detail/statusを含む場合はerrorSchema:scim", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: "invalidValue", detail: "The request body was invalid.", status: "401" }),
    });
    expect(result.errorSchema).toBe("scim");
  });

  it("scimType/detail/statusのいずれか1つだけでもscimと判定する", () => {
    expect(buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ detail: "x" }) }).errorSchema).toBe("scim");
    expect(buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ scimType: "x" }) }).errorSchema).toBe("scim");
  });

  it("code/message/messages/typeを含む場合はerrorSchema:concur", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 403,
      bodyText: JSON.stringify({ code: "insufficient_scope", message: "Access denied.", type: "error" }),
    });
    expect(result.errorSchema).toBe("concur");
  });

  it("error/error_descriptionを含む場合はerrorSchema:oauth", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error: "invalid_token", error_description: "The access token expired" }),
    });
    expect(result.errorSchema).toBe("oauth");
  });

  it("どれにも該当しない場合はerrorSchema:unknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ foo: "bar" }) });
    expect(result.errorSchema).toBe("unknown");
  });

  it("混在時はscim > concur > oauthの優先順位で判定する（scim+concur混在はscim）", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ detail: "scim detail", code: "concur_code", error: "oauth_error" }),
    });
    expect(result.errorSchema).toBe("scim");
  });

  it("混在時はscim > concur > oauthの優先順位で判定する（concur+oauth混在はconcur）", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ code: "concur_code", error: "oauth_error" }),
    });
    expect(result.errorSchema).toBe("concur");
  });

  it("JSONとして解析できない本文はerrorSchema:unknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: "<html>not json</html>" });
    expect(result.errorSchema).toBe("unknown");
    expect(result.responseJsonParsed).toBe(false);
  });

  it("配列など想定外の構造はerrorSchema:unknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify([1, 2, 3]) });
    expect(result.errorSchema).toBe("unknown");
  });
});

describe("buildSafeIdentityRejectedDebugLog（errorCode：error→errorCode→codeの優先順位）", () => {
  it("errorがあればerrorを採用する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error: "invalid_token", errorCode: "should_not_be_used", code: "should_not_be_used_either" }),
    });
    expect(result.errorCode).toBe("invalid_token");
  });

  it("errorが無くerrorCodeがあればerrorCodeを採用する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ errorCode: "some_code", code: "should_not_be_used" }),
    });
    expect(result.errorCode).toBe("some_code");
  });

  it("error/errorCodeが無くcodeだけあればcodeを採用する", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ code: "insufficient_scope" }) });
    expect(result.errorCode).toBe("insufficient_scope");
  });

  it("いずれも無ければunknown", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ detail: "no short code here" }) });
    expect(result.errorCode).toBe("unknown");
  });

  it("先の候補が安全化に失敗した場合、次の候補へフォールバックする", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ error: "user@example.com", code: "invalid_token" }),
    });
    expect(result.errorCode).toBe("invalid_token");
  });
});

describe("buildSafeIdentityRejectedDebugLog（scimType/apiCodeの抽出とサニタイズ）", () => {
  it("scimTypeを安全化して返す", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ scimType: "invalidValue" }) });
    expect(result.scimType).toBe("invalidValue");
  });

  it("scimTypeが無い場合はnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "invalid_token" }) });
    expect(result.scimType).toBeNull();
  });

  it("codeをapiCodeとして安全化して返す", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ code: "insufficient_scope" }) });
    expect(result.apiCode).toBe("insufficient_scope");
  });

  it("codeが無い場合、apiCodeはnull", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "invalid_token" }) });
    expect(result.apiCode).toBeNull();
  });

  it("非文字列のscimType/codeはnullへ丸める", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: { nested: true }, code: 12345 }),
    });
    expect(result.scimType).toBeNull();
    expect(result.apiCode).toBeNull();
  });

  it("100文字を超えるscimType/codeはnullへ丸める", () => {
    const longValue = "a".repeat(101);
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: longValue, code: longValue }),
    });
    expect(result.scimType).toBeNull();
    expect(result.apiCode).toBeNull();
  });

  it("メールアドレスらしい値はnullへ丸める", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: "user@example.com", code: "user@example.com" }),
    });
    expect(result.scimType).toBeNull();
    expect(result.apiCode).toBeNull();
  });

  it("URLらしい値はnullへ丸める", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: "https://example.com/error", code: "https://example.com/error" }),
    });
    expect(result.scimType).toBeNull();
    expect(result.apiCode).toBeNull();
  });

  it("UUIDらしい値はnullへ丸める", () => {
    const uuid = "3df11695-e8bb-40ff-8e98-c85913ab2789";
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: uuid, code: uuid }),
    });
    expect(result.scimType).toBeNull();
    expect(result.apiCode).toBeNull();
  });

  it("JWTらしい値はnullへ丸める", () => {
    const jwtLike = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: jwtLike, code: jwtLike }),
    });
    expect(result.scimType).toBeNull();
    expect(result.apiCode).toBeNull();
  });

  it("長いトークンらしい値はnullへ丸める", () => {
    const tokenLike = "A".repeat(50);
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: tokenLike, code: tokenLike }),
    });
    expect(result.scimType).toBeNull();
    expect(result.apiCode).toBeNull();
  });

  it("制御文字を含む値は除去して安全化する", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: "invalid\nValue" }),
    });
    expect(result.scimType).not.toContain("\n");
  });
});

describe("buildSafeIdentityRejectedDebugLog（detail/message/messagesは存在フラグのみ）", () => {
  it("detailが存在する場合detailPresent:trueだが、本文自体は含まれない", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ scimType: "invalidValue", detail: "SECRET_DETAIL_BODY_SHOULD_NOT_LEAK" }),
    });
    expect(result.detailPresent).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SECRET_DETAIL_BODY_SHOULD_NOT_LEAK");
    expect(Object.keys(result)).not.toContain("detail");
  });

  it("messageが存在する場合messagePresent:trueだが、本文自体は含まれない", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ code: "insufficient_scope", message: "SECRET_MESSAGE_BODY_SHOULD_NOT_LEAK" }),
    });
    expect(result.messagePresent).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SECRET_MESSAGE_BODY_SHOULD_NOT_LEAK");
  });

  it("messagesが存在する場合messagesPresent:trueだが、配列の中身は含まれない", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: JSON.stringify({ code: "insufficient_scope", messages: [{ code: "SECRET_MESSAGES_ITEM_SHOULD_NOT_LEAK" }] }),
    });
    expect(result.messagesPresent).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SECRET_MESSAGES_ITEM_SHOULD_NOT_LEAK");
  });

  it("空のmessages配列はmessagesPresent:false", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ messages: [] }) });
    expect(result.messagesPresent).toBe(false);
  });

  it("detail/message/messagesが無ければすべてfalse", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ error: "invalid_token" }) });
    expect(result.detailPresent).toBe(false);
    expect(result.messagePresent).toBe(false);
    expect(result.messagesPresent).toBe(false);
  });

  it("空文字のdetail/messageはPresent:false", () => {
    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify({ detail: "   ", message: "" }) });
    expect(result.detailPresent).toBe(false);
    expect(result.messagePresent).toBe(false);
  });
});

describe("buildSafeIdentityRejectedDebugLog（requestIdのサニタイズ・既存挙動の維持）", () => {
  it("request ID系ヘッダーが存在する場合、requestIdPresentとrequestIdを返す", () => {
    const result = buildSafeIdentityRejectedDebugLog({
      status: 401,
      bodyText: "{}",
      headers: headersFrom({ "x-request-id": "abc-123" }),
    });
    expect(result.requestIdPresent).toBe(true);
    expect(result.requestId).toBe("abc-123");
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

describe("buildSafeIdentityRejectedDebugLog（非露出の統合確認）", () => {
  it("危険な値を含む本文でも、メール・UUID・URL・Tokenらしい値がログへ一切含まれない", () => {
    const dangerousBody = {
      scimType: "invalidValue",
      detail: "user taro.yamada@example.com (id 3df11695-e8bb-40ff-8e98-c85913ab2789) at https://internal.example.com/secret",
      status: "401",
      code: "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK",
      message: "full message body",
      messages: [{ detail: "another secret" }],
      error: "user@example.com",
    };

    const result = buildSafeIdentityRejectedDebugLog({ status: 401, bodyText: JSON.stringify(dangerousBody) });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("taro.yamada@example.com");
    expect(serialized).not.toContain("3df11695-e8bb-40ff-8e98-c85913ab2789");
    expect(serialized).not.toContain("https://internal.example.com/secret");
    expect(serialized).not.toContain("DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("full message body");
    expect(serialized).not.toContain("another secret");
    expect(result.errorSchema).toBe("scim");
    expect(result.apiCode).toBeNull();
    expect(result.errorCode).toBe("unknown");
  });
});
