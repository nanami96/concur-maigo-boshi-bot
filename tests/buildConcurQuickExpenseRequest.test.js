import { describe, it, expect } from "vitest";
import { buildConcurQuickExpenseRequest } from "../supabase/functions/_shared/concur-quick-expense/buildConcurQuickExpenseRequest.js";

const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const DUMMY_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";
const DUMMY_BODY = { expenseTypeId: "MEAL", transactionDate: "2026-07-28", transactionAmount: { currencyCode: "JPY", value: 1000 } };

describe("buildConcurQuickExpenseRequest", () => {
  it("公式仕様どおりのURL・メソッド・ヘッダー・本文を組み立てる", () => {
    const dummyCorrelationId = "11111111-2222-3333-4444-555555555555";
    const request = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
      correlationId: dummyCorrelationId,
    });

    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      `${DUMMY_GEOLOCATION}/quickexpense/v4/users/${DUMMY_USER_ID}/context/TRAVELER/quickexpenses`,
    );
    expect(request.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${DUMMY_ACCESS_TOKEN}`,
      "concur-correlationid": dummyCorrelationId,
    });
    expect(request.body).toBe(JSON.stringify(DUMMY_BODY));
  });

  it("geolocationの末尾スラッシュを除去してから結合する", () => {
    const request = buildConcurQuickExpenseRequest({
      geolocation: `${DUMMY_GEOLOCATION}/`,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });

    expect(request.url).toBe(
      `${DUMMY_GEOLOCATION}/quickexpense/v4/users/${DUMMY_USER_ID}/context/TRAVELER/quickexpenses`,
    );
  });

  it("userId・contextTypeをURLエンコードする", () => {
    const request = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: "user id/with?special",
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });

    expect(request.url).toContain(encodeURIComponent("user id/with?special"));
    expect(request.url).not.toContain("user id/with?special");
  });

  it("本文はJSON.stringifyされ、公式仕様に存在しないフィールドは含まれない", () => {
    const request = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });

    const parsedBody = JSON.parse(request.body);
    expect(Object.keys(parsedBody).sort()).toEqual(Object.keys(DUMMY_BODY).sort());
  });

  it("Access Tokenの値はAuthorizationヘッダーだけに含まれ、URL・本文には含まれない", () => {
    const request = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });

    expect(request.url).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(request.body).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(request.headers.Authorization).toContain(DUMMY_ACCESS_TOKEN);
  });
});

describe("buildConcurQuickExpenseRequest（concur-correlationidヘッダー）", () => {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("correlationId未指定の場合、リクエストごとに新しいUUIDを自動生成してヘッダーへ設定する", () => {
    const first = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });
    const second = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });

    expect(first.headers["concur-correlationid"]).toMatch(UUID_PATTERN);
    expect(second.headers["concur-correlationid"]).toMatch(UUID_PATTERN);
    expect(first.headers["concur-correlationid"]).not.toBe(second.headers["concur-correlationid"]);
  });

  it("correlationIdを明示的に渡した場合、その値をそのまま使う", () => {
    const dummyCorrelationId = "11111111-2222-3333-4444-555555555555";
    const request = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
      correlationId: dummyCorrelationId,
    });

    expect(request.headers["concur-correlationid"]).toBe(dummyCorrelationId);
  });

  it("concur-correlationidの値にuserID・経費内容・Access Tokenが一切含まれない", () => {
    const request = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });

    const correlationId = request.headers["concur-correlationid"];
    expect(correlationId).not.toContain(DUMMY_ACCESS_TOKEN);
    expect(correlationId).not.toContain(DUMMY_USER_ID);
  });
});
