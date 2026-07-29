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
//   - id_token: 存在する場合のみ、文字列であることを確認する（任意項目。
//     型が文字列以外の場合は不正な応答として拒否する。文字列だが
//     trim後に空の場合は「実質的に未設定」としてnullへ丸める＝応答全体は
//     拒否しない）。
//
// 【一時的なデバッグログ・要削除】id_tokenについて：
// id_tokenはOIDCのJWT（access_token本体とは別物）で、
// concur_principal_type_diagnosticの一時デバッグ（401原因切り分けのための
// company/user種別の参考情報）だけに使う想定。DB・Vault・Secretsへの保存、
// フロントへの返却は一切行わない。デバッグが終わったら、この項目の保持
// 自体も削除を検討すること。
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
 *   idToken: string | null,
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

  if (body.id_token !== undefined && typeof body.id_token !== "string") {
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
      idToken: isNonEmptyString(body.id_token) ? body.id_token : null,
    },
  };
}
