// link-concur-userが実際にHTTPレスポンスへ変換する部分を切り出した純粋関数群。
// supabase/functions/lookup-concur-user/buildLookupConcurUserResponse.jsと
// 同じ構成（ローカル専用コードの固定メッセージ・HTTPステータスの対応表・
// 成功/エラーレスポンスの組み立て）。
//
// 【重要・ConcurログインID・User IDをフロントへ返さない設計】
// 成功時のレスポンスは { linked: true } という真偽値だけであり、実際に
// 保存されたConcurログインIDの値・Concur Identity User ID（UUID）の
// いずれもここでは一切扱わない。
const LOCAL_ERROR_MESSAGES = {
  concur_user_link_invalid_request: "入力内容を確認してください。",
  forbidden: "この操作を行う権限がありません。",
  concur_oauth_not_connected: "現在Concurとの接続情報を利用できません。",
  concur_oauth_completion_failed: "処理を確定できませんでした。もう一度お試しください。",
  concur_oauth_storage_failed: "認証情報の保存に失敗しました。もう一度お試しください。",
  concur_user_link_save_failed: "確認は成功しましたが、保存に失敗しました。もう一度お試しください。",
  internal_error: "処理中にエラーが発生しました。",
};

const ERROR_HTTP_STATUS = {
  // OAuthモジュール（_shared/concur-oauth）由来のコード（refreshConcurAccessToken()の
  // 戻り値からそのまま渡ってくる）。他のConcur関連Edge Functionと同じ対応。
  concur_not_configured: 500,
  concur_oauth_timeout: 504,
  concur_oauth_network_error: 502,
  concur_oauth_rejected: 502,
  concur_oauth_rate_limited: 429,
  concur_oauth_service_error: 502,
  concur_oauth_invalid_response: 502,
  // このFunctionのVaultリース・完了処理・会社所属確認専用のローカルコード。
  forbidden: 403,
  concur_oauth_not_connected: 503,
  concur_oauth_completion_failed: 500,
  concur_oauth_storage_failed: 500,
  concur_user_link_save_failed: 500,
  internal_error: 500,
  // このFunction専用の入力検証コード。
  concur_user_link_invalid_request: 400,
  invalid_json: 400,
  // Concur Identity API連携（_shared/concur-identity）由来のコード。
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
 * @param {string} code
 * @returns {{ code: string, message: string }}
 */
export function buildLinkConcurUserError(code) {
  return { code, message: LOCAL_ERROR_MESSAGES[code] ?? "処理中にエラーが発生しました。" };
}

/**
 * @param {string} code
 * @returns {number}
 */
export function classifyLinkConcurUserHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] ?? 500;
}

/**
 * @param {{ linked: boolean }} input
 * @returns {{ status: number, body: { result: object, error: null } }}
 */
export function buildLinkConcurUserSuccessResponse({ linked }) {
  return {
    status: 200,
    body: { result: { linked: Boolean(linked) }, error: null },
  };
}

/**
 * @param {{ code: string, message: string }} error
 * @returns {{ status: number, body: { result: null, error: { code: string, message: string } } }}
 */
export function buildLinkConcurUserErrorResponse(error) {
  return { status: classifyLinkConcurUserHttpStatus(error.code), body: { result: null, error } };
}
