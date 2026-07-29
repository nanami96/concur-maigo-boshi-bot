import { describe, it, expect } from "vitest";
import { fetchConcurTokenResponse } from "../supabase/functions/create-concur-quick-expense/fetchConcurTokenResponse.js";

// 本物のtoken endpointへは一切通信しない。fetchImplを差し替えたモックのみを使う。
const DUMMY_REQUEST = {
  url: "https://example-dummy.concursolutions.test/oauth2/v0/token",
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=refresh_token",
};

describe("fetchConcurTokenResponse", () => {
  it("fetchImplが成功した場合、outcome: 'response'でそのままResponseを返す", async () => {
    const fakeResponse = { status: 200 };
    const fetchImpl = async () => fakeResponse;

    const result = await fetchConcurTokenResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(result).toEqual({ outcome: "response", response: fakeResponse });
  });

  it("タイムアウトした場合はoutcome: 'timeout'（AbortErrorを区別する）", async () => {
    // signalがabortされるまで解決しない、実際のfetchのタイムアウト時の挙動を模したモック。
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const result = await fetchConcurTokenResponse({ request: DUMMY_REQUEST, fetchImpl, timeoutMs: 20 });

    expect(result).toEqual({ outcome: "timeout" });
  });

  it("通常のネットワークエラー（AbortError以外の例外）はoutcome: 'network_error'", async () => {
    const fetchImpl = async () => {
      throw new Error("dummy network failure: DNS resolution failed");
    };

    const result = await fetchConcurTokenResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(result).toEqual({ outcome: "network_error" });
  });

  it("fetch例外の詳細（メッセージ等）を戻り値へ一切含めない", async () => {
    const secretLikeMessage = "SHOULD_NOT_LEAK_FETCH_ERROR_DETAIL";
    const fetchImpl = async () => {
      throw new Error(secretLikeMessage);
    };

    const result = await fetchConcurTokenResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(JSON.stringify(result)).not.toContain(secretLikeMessage);
  });

  it("fetchImplへ渡す引数がrequestの内容（url・method・headers・body）と一致する", async () => {
    let capturedUrl;
    let capturedInit;
    const fetchImpl = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return { status: 200 };
    };

    await fetchConcurTokenResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(capturedUrl).toBe(DUMMY_REQUEST.url);
    expect(capturedInit.method).toBe("POST");
    expect(capturedInit.headers).toEqual(DUMMY_REQUEST.headers);
    expect(capturedInit.body).toBe(DUMMY_REQUEST.body);
    expect(capturedInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("redirect: 'error'を指定し、token endpointからのリダイレクトを追跡しない（別ホストへのClient Secret漏洩防止）", async () => {
    let capturedInit;
    const fetchImpl = async (_url, init) => {
      capturedInit = init;
      return { status: 200 };
    };

    await fetchConcurTokenResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(capturedInit.redirect).toBe("error");
  });

  it("fetchImplがredirect: 'error'指定により例外を投げた場合、network_errorとして扱う", async () => {
    const fetchImpl = async () => {
      const error = new TypeError("Failed to fetch (redirect mode is error)");
      throw error;
    };

    const result = await fetchConcurTokenResponse({ request: DUMMY_REQUEST, fetchImpl });

    expect(result).toEqual({ outcome: "network_error" });
  });
});
