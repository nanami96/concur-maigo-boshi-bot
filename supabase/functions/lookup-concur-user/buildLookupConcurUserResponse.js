// lookup-concur-userが実際にHTTPレスポンスへ変換する部分を切り出した純粋関数群。
// supabase/functions/check-concur-oauth/buildConcurOAuthCheckResponse.jsと
// 同じ構成（ローカル専用コードの固定メッセージ・HTTPステータスの対応表・
// 成功/エラーレスポンスの組み立て）。
//
// 【重要・userIDをフロントへ返さない設計】
// 成功時、Concur Identity APIから取得した実際のuserID（UUID）はここでは
// 一切扱わない。呼び出し元（handleLookupConcurUserRequest.js）は
// 「取得できたかどうか」という真偽値だけをこの関数へ渡し、この関数も
// それ以上の情報（userID本体・利用者プロフィール等）を含めない
// レスポンスだけを組み立てる。
// concur_oauth_not_connected・concur_oauth_completion_failed・
// concur_oauth_storage_failed・internal_errorは、check-concur-oauthの
// buildConcurOAuthCheckResponse.jsにも同名で存在するローカル専用コード
// （Vault RPC・Vault保存処理自体の結果を表す、OAuthモジュール由来ではない
// コード）。既存のcheck-concur-oauthへ影響を与えないよう複製している。
const LOCAL_ERROR_MESSAGES = {
  concur_oauth_not_connected: "現在Concurとの接続情報を利用できません。",
  concur_oauth_completion_failed: "処理を確定できませんでした。もう一度お試しください。",
  concur_oauth_storage_failed: "認証情報の保存に失敗しました。もう一度お試しください。",
  internal_error: "処理中にエラーが発生しました。",
};

const ERROR_HTTP_STATUS = {
  // OAuthモジュール（_shared/concur-oauth）由来のコード（refreshConcurAccessToken()の
  // 戻り値からそのまま渡ってくる）。check-concur-oauthのERROR_HTTP_STATUSと同じ対応。
  concur_not_configured: 500,
  concur_oauth_timeout: 504,
  concur_oauth_network_error: 502,
  concur_oauth_rejected: 502,
  concur_oauth_rate_limited: 429,
  concur_oauth_service_error: 502,
  concur_oauth_invalid_response: 502,
  // このFunctionのVaultレース・完了処理専用のローカルコード。
  concur_oauth_not_connected: 503,
  concur_oauth_completion_failed: 500,
  concur_oauth_storage_failed: 500,
  internal_error: 500,
  // このFunction専用の入力検証コード。
  concur_identity_invalid_request: 400,
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
 * ローカル（lookup-concur-user固有）のエラーコードに対する固定メッセージを
 * 返す。concur_identity_ / concur_user_ 系のコードはこの関数を通さず、
 * _shared/concur-identity/classifyConcurIdentityLookupError.jsの
 * buildConcurIdentityLookupError()をそのまま使うこと。
 * @param {string} code
 * @returns {{ code: string, message: string }}
 */
export function buildLookupConcurUserError(code) {
  return { code, message: LOCAL_ERROR_MESSAGES[code] ?? "処理中にエラーが発生しました。" };
}

/**
 * @param {string} code
 * @returns {number}
 */
export function classifyLookupConcurUserHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] ?? 500;
}

/**
 * @param {{ found: boolean, hasUserId?: boolean, multipleMatches?: boolean }} input
 * @returns {{ status: number, body: { result: object, error: null } }}
 */
export function buildLookupConcurUserSuccessResponse({ found, hasUserId, multipleMatches }) {
  return {
    status: 200,
    body: {
      result: {
        found: Boolean(found),
        hasUserId: Boolean(hasUserId),
        multipleMatches: Boolean(multipleMatches),
      },
      error: null,
    },
  };
}

/**
 * @param {{ code: string, message: string }} error
 * @returns {{ status: number, body: { result: null, error: { code: string, message: string } } }}
 */
export function buildLookupConcurUserErrorResponse(error) {
  return { status: classifyLookupConcurUserHttpStatus(error.code), body: { result: null, error } };
}
