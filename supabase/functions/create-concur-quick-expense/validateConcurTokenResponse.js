// token endpointが2xxで返したJSON本文（パース済み）の形式を検証し、
// 後続処理で使う内部形式（tokens）へ正規化する純粋関数。
//
// 検証する項目：
//   - access_token: 空でない文字列であることを必須とする。
//   - expires_in: 存在する場合のみ検証する（任意項目）。公式ドキュメントの
//     サンプルレスポンスでは数値ではなく数値文字列（例: "3600"）で返る例が
//     確認できているため、数値・数値として解釈できる文字列のどちらも
//     許容する（型だけで厳しく弾くと、Concur側の実際の応答形式次第で
//     正常なレスポンスまで拒否してしまうリスクがあるため）。ただし値自体は
//     「正の有限数」だけを有効とする。0・負数・NaN・Infinityはアクセス
//     トークンの有効期限として意味を成さない（0は「即座に失効」、負数は
//     解釈不能、NaN/Infinityは数値として扱えない）ため、これらは全て
//     不正な応答として拒否する（nullへ丸めて黙って通すことはしない）。
//   - refresh_token: 返る場合と返らない場合の両方を正常系として扱う。
//     存在する場合は空でない文字列であることを必須とする。
//   - token_type: 存在する場合のみ、空でない文字列であることを確認する
//     （値自体が"Bearer"かどうかまでは検証しない。空文字は「実質的に
//     未設定」と同じであり、無意味な値を後段へ通さないため空文字も拒否する）。
//   - scope / geolocation: 存在する場合のみ、文字列であることを確認する
//     （値そのものの検証は行わない）。
//
// 実際のトークン値はこの関数の戻り値（tokens）にそのまま含まれるため、
// 呼び出し元は絶対にこれをログ・エラー・レスポンスへ転記しないこと
// （ログ用にはdescribeConcurOAuthResultForLogging.jsが返す真偽値だけの
// 要約を使う）。
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// 正の有限数だけを有効とする（0・負数・NaN・Infinityは全て無効）。
function isValidExpiresIn(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
}

/**
 * @param {unknown} body token endpointのレスポンスをJSON.parseした値。
 * @returns {{ ok: true, tokens: {
 *   accessToken: string,
 *   refreshToken: string | null,
 *   tokenType: string | null,
 *   expiresIn: number | null,
 *   scope: string | null,
 *   geolocation: string | null,
 * } } | { ok: false }}
 */
export function validateConcurTokenResponse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }

  if (!isNonEmptyString(body.access_token)) {
    return { ok: false };
  }

  if (body.expires_in !== undefined && !isValidExpiresIn(body.expires_in)) {
    return { ok: false };
  }

  if (body.refresh_token !== undefined && !isNonEmptyString(body.refresh_token)) {
    return { ok: false };
  }

  if (body.token_type !== undefined && !isNonEmptyString(body.token_type)) {
    return { ok: false };
  }

  if (body.scope !== undefined && typeof body.scope !== "string") {
    return { ok: false };
  }

  if (body.geolocation !== undefined && typeof body.geolocation !== "string") {
    return { ok: false };
  }

  return {
    ok: true,
    tokens: {
      accessToken: body.access_token,
      refreshToken: isNonEmptyString(body.refresh_token) ? body.refresh_token : null,
      tokenType: typeof body.token_type === "string" ? body.token_type : null,
      expiresIn: body.expires_in !== undefined ? Number(body.expires_in) : null,
      scope: typeof body.scope === "string" ? body.scope : null,
      geolocation: typeof body.geolocation === "string" ? body.geolocation : null,
    },
  };
}
