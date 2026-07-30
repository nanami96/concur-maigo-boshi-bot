// buildConcurQuickExpenseRequest.jsが組み立てたリクエストを、明示的な
// タイムアウト付きで実際にfetchする部分だけを切り出したもの。
// supabase/functions/_shared/concur-oauth/fetchConcurTokenResponse.js・
// supabase/functions/_shared/concur-identity/fetchConcurIdentityLookupResponse.js
// と同じ構造・同じ理由（AbortControllerによるtimeout/network_errorの区別）を
// 踏襲する（OAuth・Identity用のモジュールをそのまま使い回さず複製する理由も
// 同じ：既存の疎通確認機能に影響を与えないため）。
//
// redirect: "error"について（重要・セキュリティ）：
// Quick Expense APIへのリクエストはAuthorizationヘッダー（Access Token）を
// 含むため、3xxで別ホストへリダイレクトされた場合に標準のfetchの既定挙動
// （"follow"）だと機密情報が検証していない別ホストへ転送されてしまう恐れが
// ある。redirectを"error"に固定し、リダイレクトが発生した場合はfetch自体を
// 例外で失敗させる（下のcatch節でnetwork_errorとして扱われる）。
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * @param {object} input
 * @param {{ url: string, method: string, headers: Record<string,string>, body: string }} input.request
 *   buildConcurQuickExpenseRequest()の戻り値。
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。既定はグローバルfetch。
 * @param {number} [input.timeoutMs] タイムアウト（ミリ秒）。既定10秒。
 * @returns {Promise<
 *   | { outcome: "response", response: Response }
 *   | { outcome: "timeout" }
 *   | { outcome: "network_error" }
 * >}
 */
export async function fetchConcurQuickExpenseResponse({ request, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: "error",
    });

    return { outcome: "response", response };
  } catch (caughtError) {
    if (caughtError?.name === "AbortError") {
      return { outcome: "timeout" };
    }
    // caughtError自体（メッセージ・スタック）は呼び出し元へ一切渡さない
    // （fetch例外の詳細を外部へ漏らさないための要件）。区別に必要な
    // "network_error"という分類結果だけを返す。
    return { outcome: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
