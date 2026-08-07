// create-concur-quick-expenseが内部で呼び出すOAuth（_shared/concur-oauth）・
// Identity（_shared/concur-identity）連携が返す { code, message } を、
// HTTPステータス付きのレスポンス（{ status, body }）へ変換するだけの
// 純粋関数。supabase/functions/lookup-concur-user/buildLookupConcurUserResponse.js
// のERROR_HTTP_STATUS対応表と同じ内容を、既存のcheck-concur-oauth・
// lookup-concur-userへ影響を与えないようこのFunction専用に複製している
// （このプロジェクトの既存方針：ocr-receipt/create-concur-quick-expense間の
// classify*Error関数の複製と同じ考え方）。
//
// oauthResult.error・lookupResult.errorはどちらも既に
// classifyConcurOAuthError.js・classifyConcurIdentityLookupError.jsが
// 生成した固定メッセージ付きの{code, message}であるため、ここでは
// メッセージを新たに作らず、ステータスコードの対応表だけを持つ。
const ERROR_HTTP_STATUS = {
  // _shared/concur-oauth/classifyConcurOAuthError.js由来のコード
  // （refreshConcurAccessToken()の戻り値からそのまま渡ってくる）。
  concur_not_configured: 500,
  concur_oauth_timeout: 504,
  concur_oauth_network_error: 502,
  concur_oauth_rejected: 502,
  concur_oauth_rate_limited: 429,
  concur_oauth_service_error: 502,
  concur_oauth_invalid_response: 502,
  // _shared/concur-identity/classifyConcurIdentityLookupError.js由来のコード
  // （lookupConcurUser()の戻り値からそのまま渡ってくる）。
  concur_user_not_found: 404,
  concur_user_ambiguous: 409,
  concur_identity_geolocation_missing: 500,
  concur_identity_invalid_response: 502,
  concur_identity_rejected: 502,
  concur_identity_rate_limited: 429,
  concur_identity_service_error: 502,
  concur_identity_timeout: 504,
  concur_identity_network_error: 502,
};

/**
 * @param {{ code: string, message: string }} error
 * @returns {{ status: number, body: { result: null, error: { code: string, message: string, details: [] } } }}
 */
export function buildQuickExpenseUpstreamErrorResponse(error) {
  const status = ERROR_HTTP_STATUS[error.code] ?? 500;
  return { status, body: { result: null, error: { code: error.code, message: error.message, details: [] } } };
}
