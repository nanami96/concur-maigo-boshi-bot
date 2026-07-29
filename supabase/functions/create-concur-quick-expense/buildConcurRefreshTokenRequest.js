// resolveConcurOAuthConfig.jsで検証済みのconfigから、Concur OAuth2の
// token endpoint（POST .../oauth2/v0/token）へ送るリクエスト記述子を組み立てる
// 純粋関数。実際のfetch呼び出しはfetchConcurTokenResponse.jsが行う（この
// ファイルはリクエストの「形」を作るだけで、通信は一切行わない）。
//
// Concur側の仕様（公式ドキュメント調査済み。回答・コード上に実値は書かない）：
//   grant_type=refresh_token での呼び出しに必要なのは
//   client_id・client_secret・refresh_token・grant_typeの4項目のみ（scopeは任意）。
//   Company Request Token・Company UUIDはこのリクエストには一切含まれない
//   （初回のPassword Grantでのみ使用するため、今回のRefresh Token Grantでは不要）。
//
// bodyは意図的にJSONにしない。application/x-www-form-urlencoded形式の
// 文字列（URLSearchParamsで組み立てる）とし、Content-Typeヘッダーも
// 明示的にこの値へ固定する。
export function buildConcurRefreshTokenRequest(config) {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("client_id", config.clientId);
  params.set("client_secret", config.clientSecret);
  params.set("refresh_token", config.refreshToken);

  if (config.scope) {
    params.set("scope", config.scope);
  }

  return {
    url: config.tokenUrl,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  };
}
