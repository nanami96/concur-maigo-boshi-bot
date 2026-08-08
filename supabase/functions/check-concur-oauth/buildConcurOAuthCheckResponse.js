// check-concur-oauthが実際にHTTPレスポンスへ変換する部分を切り出した純粋関数群。
// ここを通過した後のbodyだけがそのままレスポンスとして返される想定のため、
// 実際のトークン値・Secrets・token endpoint URL・OAuthサーバーの生レスポンスが
// 一切含まれないことが、この関数群全体の安全性の根拠になる。
//
// 【Vault保存対応後の位置づけ】
// 以前はrotated:trueを常に「保存できないため失敗」として扱っていたが、
// Vaultへの保存（complete_concur_oauth_refresh RPC）に対応したことに伴い、
// 実際に保存が成功した場合はconnected:trueを返せるようになった。代わりに、
// 「保存の実行そのもの」が失敗した場合（complete RPCがfalseを返す＝リースが
// 既に無効、または例外＝Vault更新自体が失敗）を新しく区別する必要がある
// （concur_oauth_completion_failed / concur_oauth_storage_failed）。
//
// 【concur_oauth_lockedを個別に公開しない理由】
// 「対象の接続が存在しない」場合と「他のリクエストが処理中でロックされている」
// 場合を外部レスポンスで区別すると、呼び出し元（platform_admin）以外の何者かが
// 応答の違いから接続の存在有無を推測できてしまう（オラクル化）リスクがある。
// そのため、get_concur_refresh_token_for_edge()が0行を返した場合は理由を
// 区別せず、単一のconcur_oauth_not_connectedへ統合する。
const LOCAL_ERROR_MESSAGES = {
  concur_oauth_not_connected: "現在Concurとの接続情報を利用できません。",
  concur_oauth_completion_failed: "処理を確定できませんでした。もう一度お試しください。",
  concur_oauth_storage_failed: "認証情報の保存に失敗しました。もう一度お試しください。",
  internal_error: "処理中にエラーが発生しました。",
  // 【会社別OAuth接続対応で追加】
  invalid_json: "リクエストの形式が不正です。",
  concur_oauth_check_invalid_request: "対象の会社を指定してください。",
};

const ERROR_HTTP_STATUS = {
  concur_not_configured: 500,
  concur_oauth_timeout: 504,
  concur_oauth_network_error: 502,
  concur_oauth_rejected: 502,
  concur_oauth_rate_limited: 429,
  concur_oauth_service_error: 502,
  concur_oauth_invalid_response: 502,
  concur_oauth_not_connected: 503,
  concur_oauth_completion_failed: 500,
  concur_oauth_storage_failed: 500,
  internal_error: 500,
  // 【会社別OAuth接続対応で追加】
  invalid_json: 400,
  concur_oauth_check_invalid_request: 400,
};

/**
 * ローカル（check-concur-oauth固有）のエラーコードに対する固定メッセージを
 * 返す。共有OAuthモジュール由来のコード（concur_oauth_timeout等、既に
 * {code, message}の形でmessageが決まっている）はこの関数を通さず、
 * そのまま使うこと。
 * @param {string} code
 * @returns {{ code: string, message: string }}
 */
export function buildConcurOAuthCheckError(code) {
  return { code, message: LOCAL_ERROR_MESSAGES[code] ?? "処理中にエラーが発生しました。" };
}

/**
 * @param {string} code
 * @returns {number}
 */
export function classifyConcurOAuthCheckHttpStatus(code) {
  return ERROR_HTTP_STATUS[code] ?? 500;
}

/**
 * @param {{
 *   hasGeolocation?: boolean,
 *   expiresInPresent?: boolean,
 *   rotated?: boolean,
 *   scopePresent?: boolean,
 *   hasQuickExpenseWriteScope?: boolean,
 *   hasUserReadScope?: boolean,
 *   hasIdentityUserIdsReadScope?: boolean,
 * }} input
 * @returns {{ status: number, body: { result: object, error: null } }}
 */
export function buildConcurOAuthCheckSuccessResponse({
  hasGeolocation,
  expiresInPresent,
  rotated,
  scopePresent,
  hasQuickExpenseWriteScope,
  hasUserReadScope,
  hasIdentityUserIdsReadScope,
}) {
  return {
    status: 200,
    body: {
      result: {
        connected: true,
        hasGeolocation: Boolean(hasGeolocation),
        expiresInPresent: Boolean(expiresInPresent),
        refreshTokenRotated: Boolean(rotated),
        scopePresent: Boolean(scopePresent),
        hasQuickExpenseWriteScope: Boolean(hasQuickExpenseWriteScope),
        hasUserReadScope: Boolean(hasUserReadScope),
        hasIdentityUserIdsReadScope: Boolean(hasIdentityUserIdsReadScope),
      },
      error: null,
    },
  };
}

/**
 * @param {{ code: string, message: string }} error
 * @returns {{ status: number, body: { result: null, error: { code: string, message: string } } }}
 */
export function buildConcurOAuthCheckErrorResponse(error) {
  return { status: classifyConcurOAuthCheckHttpStatus(error.code), body: { result: null, error } };
}
