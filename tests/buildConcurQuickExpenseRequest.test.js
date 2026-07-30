import { describe, it, expect } from "vitest";
import { buildConcurQuickExpenseRequest } from "../supabase/functions/_shared/concur-quick-expense/buildConcurQuickExpenseRequest.js";

const DUMMY_ACCESS_TOKEN = "DUMMY_ACCESS_TOKEN_SHOULD_NOT_LEAK";
const DUMMY_GEOLOCATION = "https://example-dummy.concursolutions.test";
const DUMMY_USER_ID = "3df11695-e8bb-40ff-8e98-c85913ab2789";
const DUMMY_BODY = { expenseTypeId: "MEAL", transactionDate: "2026-07-28", transactionAmount: { currencyCode: "JPY", value: 1000 } };

describe("buildConcurQuickExpenseRequest", () => {
  it("公式仕様どおりのURL・メソッド・ヘッダー・本文を組み立てる", () => {
    const request = buildConcurQuickExpenseRequest({
      geolocation: DUMMY_GEOLOCATION,
      accessToken: DUMMY_ACCESS_TOKEN,
      userId: DUMMY_USER_ID,
      contextType: "TRAVELER",
      quickExpenseBody: DUMMY_BODY,
    });

    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      `${DUMMY_GEOLOCATION}/quickexpense/v4/users/${DUMMY_USER_ID}/context/TRAVELER/quickexpenses`,
    );
    expect(request.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${DUMMY_ACCESS_TOKEN}`,
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
