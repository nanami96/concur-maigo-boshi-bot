// Quick Expense APIのHTTPレスポンスのステータスコードだけを見て内部エラー
// コードへ分類する純粋関数。レスポンス本文（Error本文・利用者情報等）は
// 一切参照しない（supabase/functions/_shared/concur-oauth/
// classifyConcurOAuthHttpStatus.js・supabase/functions/_shared/
// concur-identity/classifyConcurIdentityHttpStatus.jsと同じ方針）。
//
// 公式ドキュメント（v4.quick-expense.md、Create Quick Expense両オペレーション
// 共通のStatus Codes節）に明記されているステータスコードは
// 201（成功）・400・403・429・500の5つのみ。401・404・409・502・503・504は
// このエンドポイント固有のドキュメントには明記されていないが、Concur API
// プラットフォーム全体・一般的なAPI gatewayの挙動として発生しうるため、
// 防御的に分類する（この判断は実装時の最終報告で明記する。「不明な事項を
// 推測で実装しない」の対象は事実の断定であり、防御的なフォールバック処理を
// 追加すること自体ではない）。
//
// 戻り値がnullの場合は「エラーではない（201、後続のレスポンス本文解析へ
// 進んでよい）」ことを意味する。
export function classifyConcurQuickExpenseHttpStatus(status) {
  if (typeof status !== "number") {
    return "concur_quick_expense_invalid_response";
  }

  if (status >= 200 && status < 300) {
    return null;
  }

  if (status === 429) {
    return "concur_quick_expense_rate_limited";
  }

  if (status >= 500) {
    // 500は公式ドキュメントに明記。501-504は防御的にまとめて
    // service_errorへ分類する（Identity実装と同じ方針）。
    return "concur_quick_expense_service_error";
  }

  if (status === 401 || status === 403) {
    // 403は公式ドキュメントに明記。401はこのエンドポイント固有の
    // ドキュメントには無いが、認証・認可の拒否として同じ分類に含める
    // （防御的な扱い）。
    return "concur_quick_expense_rejected";
  }

  if (status === 400) {
    // 公式ドキュメントに明記。Error/Validation Errorsスキーマに基づき、
    // 「送信したRequest Bodyが拒否された」ことを表す専用コードとする
    // （後述のinvalid_responseとは意味を分ける）。
    return "concur_quick_expense_invalid_request";
  }

  if (status >= 400) {
    // 404・409等、このエンドポイント固有のドキュメントには明記されていない
    // 4xx。リクエスト自体が想定外（誤ったuserID・URLの到達不可等）である
    // ことを示すため、安全側でinvalid_responseへ分類する
    // （Identity実装の400・404の扱いと同じ考え方）。
    return "concur_quick_expense_invalid_response";
  }

  // 3xx等、Concur側が返すと想定していない応答。実運用では
  // fetchConcurQuickExpenseResponse.jsがredirect: "error"を指定している
  // ため、3xxは通常この分類器に到達する前にfetch自体の例外（network_error）
  // として扱われる。ここは主に、モック等で3xxのレスポンスオブジェクトが
  // 直接渡された場合の防御的な分岐。
  return "concur_quick_expense_invalid_response";
}
