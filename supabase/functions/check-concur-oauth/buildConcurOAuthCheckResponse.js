// refreshConcurAccessToken()（supabase/functions/_shared/concur-oauth/）の
// 戻り値を、利用者（platform_admin）へ実際に返してよい安全な形へ変換する
// 純粋関数。ここを通過した後のbodyだけが、そのままHTTPレスポンスとして
// 返される想定であるため、この関数の戻り値に実際のトークン値・Secrets・
// token endpoint URL・OAuthサーバーの生レスポンスが含まれないことが、
// この関数全体の安全性の根拠になる。
//
// 【Refresh Tokenローテーションについて・重要】
// oauthResult.rotatedがtrueの場合、成功として扱わない。理由：現時点では
// 新しいRefresh Tokenを保存する仕組みが無く（isConcurOAuthCheckEnabled.js
// 冒頭コメント参照）、ここでconnected: trueを返すと、実際には新しい
// Refresh Tokenが破棄されたままになっていることが呼び出し元から見えなくなる。
// 「認証情報の更新が必要」という固定状態（concur_oauth_rotation_unsupported）
// を返し、成功扱いにしない。
//
// 【残るリスク（最終報告にも明記）】
// この分岐は「ローテーションを検知して安全に失敗させる」だけであり、
// Concur側で実際に新しいRefresh Tokenへの切り替えが行われた場合、
// 古いRefresh Token（Supabase Secretsに設定済みの値）がConcur側の実装次第で
// 失効している可能性がある。その場合、次回以降の疎通確認もconcur_oauth_rejected
// 等で失敗し続け、再度Concur側で手動の認証情報再取得（Company Request Token
// 発行からのやり直し）が必要になる。この安全ゲート自体は「気づかないまま
// 誤った成功を返す」ことを防ぐものであり、再認証の手間そのものを無くすもの
// ではない。
const ERROR_HTTP_STATUS = {
  concur_not_configured: 500,
  concur_oauth_timeout: 504,
  concur_oauth_network_error: 502,
  concur_oauth_rejected: 502,
  concur_oauth_rate_limited: 429,
  concur_oauth_service_error: 502,
  concur_oauth_invalid_response: 502,
};

const ROTATION_UNSUPPORTED_MESSAGE =
  "Concur側でRefresh Tokenが更新されましたが、保存する仕組みが未実装のため処理を中断しました。認証情報の更新が必要です。";

/**
 * @param {Awaited<ReturnType<typeof import("../_shared/concur-oauth/refreshConcurAccessToken.js").refreshConcurAccessToken>>} oauthResult
 * @returns {{ status: number, body: { result: object|null, error: { code: string, message: string }|null } }}
 */
export function buildConcurOAuthCheckResponse(oauthResult) {
  if (!oauthResult.ok) {
    const status = ERROR_HTTP_STATUS[oauthResult.error.code] ?? 500;
    return { status, body: { result: null, error: oauthResult.error } };
  }

  if (oauthResult.rotated) {
    return {
      status: 409,
      body: {
        result: null,
        error: { code: "concur_oauth_rotation_unsupported", message: ROTATION_UNSUPPORTED_MESSAGE },
      },
    };
  }

  return {
    status: 200,
    body: {
      result: {
        connected: true,
        hasGeolocation: Boolean(oauthResult.logSummary?.hasGeolocation),
        expiresInPresent: Boolean(oauthResult.logSummary?.expiresInPresent),
        refreshTokenRotated: false,
      },
      error: null,
    },
  };
}
