// fetchConcurTokenResponse.jsがHTTPレスポンス自体を受け取れた場合に、
// そのステータスコードだけを見て内部エラーコードへ分類する純粋関数。
// レスポンス本文（error_description等、OAuthサーバーが返す詳細）は
// 一切参照しない・利用者向けレスポンスへ転記しない（要件どおり、生の
// レスポンス本文は常に切り捨てる）。
//
// 戻り値がnullの場合は「エラーではない（2xx、後続のtokenレスポンス検証へ
// 進んでよい）」ことを意味する。
export function classifyConcurOAuthHttpStatus(status) {
  if (typeof status !== "number") {
    return "concur_oauth_invalid_response";
  }

  if (status >= 200 && status < 300) {
    return null;
  }

  if (status === 429) {
    return "concur_oauth_rate_limited";
  }

  if (status >= 500) {
    return "concur_oauth_service_error";
  }

  if (status >= 400) {
    // 400（invalid_request等）・401（invalid_client等）に加え、403・404等
    // 429以外の4xx全般をここでまとめて扱う。これらを個別に
    // concur_oauth_invalid_response（レスポンス形式が想定外）として区別
    // しない理由：403・404であってもtoken endpoint自体は正しく応答して
    // おり、「形式が読めない」わけではなく「この認証情報・リクエストでは
    // 認可されない」という意味であることに変わりはないため、400・401と
    // 同じ「認証情報・Refresh Token自体が拒否された」という単一の分類
    // （concur_oauth_rejected）にまとめる方が、呼び出し元の分岐を
    // 増やさずに済み、かつ意味的にも正確である。
    return "concur_oauth_rejected";
  }

  // 3xx等、Concur側のtoken endpointが返すと想定していない応答。
  // なお実運用ではfetchConcurTokenResponse.jsがredirect: "error"を
  // 指定しているため、3xxは通常この分類器に到達する前にfetch自体の
  // 例外（network_error）として扱われる。ここは主に、モック等で
  // 3xxのレスポンスオブジェクトが直接渡された場合の防御的な分岐。
  return "concur_oauth_invalid_response";
}
