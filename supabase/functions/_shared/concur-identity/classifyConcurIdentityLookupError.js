// Concur Identity API連携（利用者検索）で起こりうる内部エラーコードを、
// 利用者向けの固定メッセージへ変換する。supabase/functions/_shared/
// concur-oauth/classifyConcurOAuthError.jsと同じ方針：メッセージは常に
// 固定文言のみとし、Identity APIの生レスポンス・利用者プロフィール
// （氏名・メールアドレス等）・Access Token・error本文は一切含めない。
const MESSAGES = {
  concur_identity_invalid_request: "入力内容を確認してください。",
  concur_user_not_found: "指定された利用者情報が見つかりませんでした。",
  concur_user_ambiguous: "指定された条件に一致する利用者が複数見つかりました。より詳細な条件を指定してください。",
  concur_identity_geolocation_missing: "Concur連携の情報が不足しているため、利用者情報を確認できませんでした。",
  concur_identity_invalid_response: "Concur利用者情報サーバーからの応答を処理できませんでした。",
  concur_identity_rejected: "Concur利用者情報サーバーへのアクセスが拒否されました。",
  concur_identity_rate_limited: "Concur利用者情報サーバーへのリクエストが集中しています。しばらくしてから再度お試しください。",
  concur_identity_service_error: "Concur利用者情報サーバーでエラーが発生しました。",
  concur_identity_timeout: "Concur利用者情報サーバーへの接続がタイムアウトしました。",
  concur_identity_network_error: "Concur利用者情報サーバーへの接続に失敗しました。",
};

const DEFAULT_MESSAGE = "Concur利用者情報の確認でエラーが発生しました。";

/**
 * @param {keyof typeof MESSAGES} code
 * @returns {{ code: string, message: string }}
 */
export function buildConcurIdentityLookupError(code) {
  return { code, message: MESSAGES[code] ?? DEFAULT_MESSAGE };
}
