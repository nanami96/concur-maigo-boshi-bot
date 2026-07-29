// buildConcurIdentityLookupRequest.jsが組み立てたリクエストを、明示的な
// タイムアウト付きで実際にfetchする部分だけを切り出したもの。
// supabase/functions/_shared/concur-oauth/fetchConcurTokenResponse.jsと
// 同じ構造・同じ理由（AbortControllerによるtimeout/network_errorの区別、
// redirect: "error"によるAccess Tokenの別ホストへの漏洩防止）を踏襲する
// （OAuth用のモジュールをそのまま使い回さず複製する理由も同じ：
// 既存のOAuth疎通確認機能に影響を与えないため）。
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * @param {object} input
 * @param {{ url: string, method: string, headers: Record<string,string> }} input.request
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。既定はグローバルfetch。
 * @param {number} [input.timeoutMs] タイムアウト（ミリ秒）。既定10秒。
 * @returns {Promise<
 *   | { outcome: "response", response: Response }
 *   | { outcome: "timeout" }
 *   | { outcome: "network_error" }
 * >}
 */
export async function fetchConcurIdentityLookupResponse({ request, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
      redirect: "error",
    });

    return { outcome: "response", response };
  } catch (caughtError) {
    if (caughtError?.name === "AbortError") {
      return { outcome: "timeout" };
    }
    return { outcome: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
