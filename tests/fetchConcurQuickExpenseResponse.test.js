import { describe, it, expect } from "vitest";
import { fetchConcurQuickExpenseResponse } from "../supabase/functions/_shared/concur-quick-expense/fetchConcurQuickExpenseResponse.js";

// 本物のQuick Expense APIへは一切通信しない。fetchImplを差し替えたモックのみを使う。
const DUMMY_REQUEST = {
  url: "https://example-dummy.concursolutions.test/quickexpense/v4/users/dummy-user-id/context/TRAVELER/quickexpenses",
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer dummy-access-token" },
  body: JSON.stringify({ expenseTypeId: "MEAL" }),
};

describe("fetchConcurQuickExpenseResponse", () => {
  it("fetchImplが成功した場合、outcome: 'response'でそのままResponseを返す", async () => {
    const fakeResponse = { status: 201 };
    const fetchImpl = async () => fakeResponse;

    const result = await fetchConcurQuickExpenseResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(result).toEqual({ outcome: "response", response: fakeResponse });
  });

  it("タイムアウトした場合はoutcome: 'timeout'（AbortErrorを区別する）", async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const result = await fetchConcurQuickExpenseResponse({ request: DUMMY_REQUEST, fetchImpl, timeoutMs: 20 });

    expect(result).toEqual({ outcome: "timeout" });
  });

  it("通常のネットワークエラー（AbortError以外の例外）はoutcome: 'network_error'", async () => {
    const fetchImpl = async () => {
      throw new Error("dummy network failure: DNS resolution failed");
    };

    const result = await fetchConcurQuickExpenseResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(result).toEqual({ outcome: "network_error" });
  });

  it("fetch例外の詳細（メッセージ等）を戻り値へ一切含めない", async () => {
    const secretLikeMessage = "SHOULD_NOT_LEAK_FETCH_ERROR_DETAIL";
    const fetchImpl = async () => {
      throw new Error(secretLikeMessage);
    };

    const result = await fetchConcurQuickExpenseResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(JSON.stringify(result)).not.toContain(secretLikeMessage);
  });

  it("fetchImplへ渡す引数がrequestの内容（url・method・headers・body）と一致する", async () => {
    let capturedUrl;
    let capturedInit;
    const fetchImpl = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return { status: 201 };
    };

    await fetchConcurQuickExpenseResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(capturedUrl).toBe(DUMMY_REQUEST.url);
    expect(capturedInit.method).toBe("POST");
    expect(capturedInit.headers).toEqual(DUMMY_REQUEST.headers);
    expect(capturedInit.body).toBe(DUMMY_REQUEST.body);
    expect(capturedInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("redirect: 'error'を指定し、Quick Expense APIからのリダイレクトを追跡しない（Access Tokenの別ホストへの漏洩防止）", async () => {
    let capturedInit;
    const fetchImpl = async (_url, init) => {
      capturedInit = init;
      return { status: 201 };
    };

    await fetchConcurQuickExpenseResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(capturedInit.redirect).toBe("error");
  });

  it("fetchImplがredirect: 'error'指定により例外を投げた場合、network_errorとして扱う", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch (redirect mode is error)");
    };

    const result = await fetchConcurQuickExpenseResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(result).toEqual({ outcome: "network_error" });
  });
});
