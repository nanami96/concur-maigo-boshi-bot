// Identity APIのHTTPレスポンスのステータスコードだけを見て内部エラーコードへ
// 分類する純粋関数。レスポンス本文（利用者プロフィール・エラー詳細等）は
// 一切参照しない（supabase/functions/_shared/concur-oauth/
// classifyConcurOAuthHttpStatus.jsと同じ方針）。
//
// 公式ドキュメント（v4.identity.md）に明記されているステータスコードは
// 200/400/401/404/500/501/502/503/504。429（レート制限）はこのエンドポイント固有の
// ドキュメントには明記されていないが、Concur APIプラットフォーム全体・
// 一般的なAPI gatewayの挙動として発生しうるため、防御的に扱う
// （「不明な事項を推測で実装しない」の対象は事実の断定であり、防御的な
// フォールバック処理を追加すること自体ではない。この判断は最終報告で
// 明記する）。
//
// 戻り値がnullの場合は「エラーではない（2xx、後続のレスポンス本文解析へ
// 進んでよい）」ことを意味する。
export function classifyConcurIdentityHttpStatus(status) {
  if (typeof status !== "number") {
    return "concur_identity_invalid_response";
  }

  if (status >= 200 && status < 300) {
    return null;
  }

  if (status === 429) {
    return "concur_identity_rate_limited";
  }

  if (status >= 500) {
    // 500/501/502/503/504はすべてConcur側のサービスエラーとしてまとめる。
    return "concur_identity_service_error";
  }

  if (status === 401 || status === 403) {
    return "concur_identity_rejected";
  }

  if (status >= 400) {
    // 400・404等。「0件検索結果」は公式ドキュメントの例のとおりHTTP 200 +
    // 空のResources配列で表現されるため、404はここでは「0件」を意味しない。
    // 400・404がこのエンドポイントで実際に返る場合、リクエスト自体が想定外
    // （filter構文エラー・エンドポイント自体の到達不可等）であることを示す
    // ため、安全側でinvalid_responseへ分類する。
    return "concur_identity_invalid_response";
  }

  // 3xx等、Concur側が返すと想定していない応答。実運用では
  // fetchConcurIdentityLookupResponse.jsがredirect: "error"を指定している
  // ため、3xxは通常この分類器に到達する前にfetch自体の例外（network_error）
  // として扱われる。ここは主に、モック等で3xxのレスポンスオブジェクトが
  // 直接渡された場合の防御的な分岐。
  return "concur_identity_invalid_response";
}
