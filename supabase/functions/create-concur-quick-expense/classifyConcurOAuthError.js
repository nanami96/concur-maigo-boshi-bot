// Concur OAuth（Refresh Token Grant）で起こりうる内部エラーコードを、
// 利用者向け（将来これを表示する場合に備えた）の固定メッセージへ変換する。
//
// メッセージは常に固定文言のみとし、Concur側のOAuthサーバーが返す
// error_description・生のレスポンス本文・リクエスト内容（client_id等）は
// 一切含めない（要件：OAuthサーバーのerror_description等をそのまま
// 利用者向けレスポンスやログへ出さない）。
const MESSAGES = {
  concur_not_configured: "Concur連携の設定が完了していません。",
  concur_oauth_timeout: "Concur認証サーバーへの接続がタイムアウトしました。",
  concur_oauth_network_error: "Concur認証サーバーへの接続に失敗しました。",
  concur_oauth_rejected: "Concurの認証情報が拒否されました。",
  concur_oauth_rate_limited: "Concur認証サーバーへのリクエストが集中しています。しばらくしてから再度お試しください。",
  concur_oauth_service_error: "Concur認証サーバーでエラーが発生しました。",
  concur_oauth_invalid_response: "Concur認証サーバーからの応答を処理できませんでした。",
};

const DEFAULT_MESSAGE = "Concur連携でエラーが発生しました。";

/**
 * @param {keyof typeof MESSAGES} code
 * @returns {{ code: string, message: string }}
 */
export function buildConcurOAuthError(code) {
  return { code, message: MESSAGES[code] ?? DEFAULT_MESSAGE };
}
