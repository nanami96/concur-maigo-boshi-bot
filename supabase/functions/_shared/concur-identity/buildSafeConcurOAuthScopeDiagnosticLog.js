// 【一時的なデバッグログ・要削除】concur_identity_rejected（401）の原因切り分けの
// ため、OAuth Tokenレスポンスで実際に付与されたscopeに
// identity.user.ids.readが含まれているかどうかの真偽値だけを組み立てる。
//
// scopeの生値・件数・他のscope名は一切戻り値に含めない（真偽値2つだけ）。
// refreshConcurAccessToken()が検証済みTokenレスポンスから保持している
// scope文字列（tokens.scope）だけを入力として使う。
//
// デバッグが終わったら、この関数自体と呼び出し箇所
// （handleLookupConcurUserRequest.js）を削除すること。

const IDENTITY_USER_IDS_READ_SCOPE = "identity.user.ids.read";

/**
 * @param {object} input
 * @param {string | null | undefined} input.scope refreshConcurAccessToken()のtokens.scope。
 * @returns {{
 *   stage: "concur_oauth_scope_diagnostic",
 *   scopePresent: boolean,
 *   hasIdentityUserIdsRead: boolean,
 * }}
 */
export function buildSafeConcurOAuthScopeDiagnosticLog({ scope }) {
  const scopePresent = typeof scope === "string" && scope.trim() !== "";

  // 半角空白等（連続する空白文字全般）で分割し、identity.user.ids.readとの
  // 完全一致だけを見る（部分一致・前方一致は一致とみなさない）。
  const hasIdentityUserIdsRead = scopePresent
    ? scope
        .trim()
        .split(/\s+/)
        .includes(IDENTITY_USER_IDS_READ_SCOPE)
    : false;

  return {
    stage: "concur_oauth_scope_diagnostic",
    scopePresent,
    hasIdentityUserIdsRead,
  };
}
