// Concur Quick Expense API連携で起こりうる内部エラーコードを、利用者向けの
// 固定メッセージへ変換する。supabase/functions/_shared/concur-oauth/
// classifyConcurOAuthError.js・supabase/functions/_shared/concur-identity/
// classifyConcurIdentityLookupError.jsと同じ方針：メッセージは常に固定文言
// のみとし、Quick Expense APIの生レスポンス・Error本文（errorMessage・
// validationErrors等）・利用者情報・Access Token等は一切含めない。
const MESSAGES = {
  concur_quick_expense_invalid_request: "入力内容を確認してください。",
  concur_quick_expense_geolocation_missing: "Concur連携の情報が不足しているため、経費を登録できませんでした。",
  concur_quick_expense_rejected: "Concur経費サーバーへのアクセスが拒否されました。",
  concur_quick_expense_rate_limited: "Concur経費サーバーへのリクエストが集中しています。しばらくしてから再度お試しください。",
  concur_quick_expense_service_error: "Concur経費サーバーでエラーが発生しました。",
  concur_quick_expense_invalid_response: "Concur経費サーバーからの応答を処理できませんでした。",
  concur_quick_expense_timeout: "Concur経費サーバーへの接続がタイムアウトしました。",
  concur_quick_expense_network_error: "Concur経費サーバーへの接続に失敗しました。",
};

const DEFAULT_MESSAGE = "Concur経費登録の処理でエラーが発生しました。";

/**
 * @param {keyof typeof MESSAGES} code
 * @returns {{ code: string, message: string }}
 */
export function buildConcurQuickExpenseError(code) {
  return { code, message: MESSAGES[code] ?? DEFAULT_MESSAGE };
}
