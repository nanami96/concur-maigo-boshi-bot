// validateConcurTokenResponse.jsが返すtokens（実際のトークン値を含む）から、
// ログへ安全に出力できる、真偽値だけの要約を作る純粋関数。
// describeAuthHeaderForLogging.js（Authorizationヘッダーの中身を一切含まない
// 要約を作る既存ファイル）と同じ考え方を、Concur OAuthのトークン一式に
// 適用したもの。
//
// この関数の戻り値には、access_token・refresh_token・scope・geolocation等の
// 実際の値を一切含めない（トークンの有無・機微度に関わらず全て真偽値化する）。
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {ReturnType<typeof import("./validateConcurTokenResponse.js").validateConcurTokenResponse>["tokens"] | null | undefined} tokens
 * @returns {{
 *   hasAccessToken: boolean,
 *   hasRefreshToken: boolean,
 *   hasGeolocation: boolean,
 *   hasScope: boolean,
 *   expiresInPresent: boolean,
 * }}
 */
export function describeConcurOAuthResultForLogging(tokens) {
  return {
    hasAccessToken: isNonEmptyString(tokens?.accessToken),
    hasRefreshToken: isNonEmptyString(tokens?.refreshToken),
    hasGeolocation: isNonEmptyString(tokens?.geolocation),
    hasScope: isNonEmptyString(tokens?.scope),
    expiresInPresent: typeof tokens?.expiresIn === "number" && Number.isFinite(tokens.expiresIn),
  };
}
