// buildConcurRefreshTokenRequest.jsが組み立てたリクエストを、明示的な
// タイムアウト付きで実際にfetchする部分だけを切り出したもの。
//
// AbortControllerを使い、「タイムアウトで打ち切った」場合と「通常の
// ネットワークエラー（DNS解決失敗・接続拒否等）でfetch自体が失敗した」場合を
// 区別できるようにする（呼び出し元がconcur_oauth_timeout /
// concur_oauth_network_errorを正しく使い分けるために必要）。
//
// fetch自体はDeno/Node/ブラウザいずれのグローバル`fetch`とも互換の標準API
// なので、Deno固有のAPIには依存しない。テストではfetchImplに差し替え用の
// モック関数を渡すことで、Node/vitestから直接検証できる（本物のtoken
// endpointへは一切通信しない）。
//
// redirect: "error"について（重要・セキュリティ）：
// token endpointが3xxで別ホストへリダイレクトした場合、標準のfetchの既定
// 挙動（"follow"）だとAuthorization相当の機密情報（ここではclient_secret・
// refresh_tokenを含むリクエストbody）が、検証していない別ホストへそのまま
// 転送されてしまう恐れがある。resolveConcurOAuthConfig.jsでCONCUR_TOKEN_URL
// 自体は事前にhttps URLとして検証済みだが、それでも実際の通信時に悪意ある
// リダイレクトを差し込まれるリスクはゼロではないため、redirectを"error"に
// 固定し、リダイレクトが発生した場合はfetch自体を例外で失敗させる
// （下のcatch節でnetwork_errorとして扱われる）。
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * @param {object} input
 * @param {{ url: string, method: string, headers: Record<string,string>, body: string }} input.request
 *   buildConcurRefreshTokenRequest()の戻り値。
 * @param {typeof fetch} [input.fetchImpl] テスト用の差し替え。既定はグローバルfetch。
 * @param {number} [input.timeoutMs] タイムアウト（ミリ秒）。既定10秒。
 * @returns {Promise<
 *   | { outcome: "response", response: Response }
 *   | { outcome: "timeout" }
 *   | { outcome: "network_error" }
 * >}
 */
export async function fetchConcurTokenResponse({ request, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
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
