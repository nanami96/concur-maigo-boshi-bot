// SAP Concur Identity v4 API（GET /profile/identity/v4/Users）で、
// userName（ConcurログインID）を条件に利用者を検索するリクエストを組み立てる
// 純粋関数。fetchは行わない（fetchConcurIdentityLookupResponse.jsの責務）。
//
// 【根拠（公式ドキュメントのみ）】
// SAP-docs/preview.developer.concur.com（developer.concur.com公式ドキュメントの
// 公開ミラー）api-reference/profile/v4.identity.md：
//   - エンドポイント: `GET https://{datacenterURI}/profile/identity/v4/Users`
//   - filterパラメータ: 「Supported attributes: userName, employeeNumber and
//     externalId.」→ 今回はuserName（ConcurログインID）で検索するため
//     `filter=userName eq "value"` を使う。
//   - attributesパラメータ: 「A multi-valued list of strings indicating the
//     names of resource attributes to return in the response.」
//     → `id`だけを要求し、氏名・メールアドレス等の不要なPIIをConcur側から
//     そもそも返させない（要求時点での最小化）。
//   - countパラメータ: 「The desired maximum number of query results per
//     page. Maximum count: 100. Default: 10.」
//     → 1件だけ要求するとcount=1で「複数件ヒットした」事実を検出できなく
//     なるため、あえて2を指定し、2件返ってくれば「複数件」と判定できる
//     ようにする（userNameはConcur全体で一意という仕様だが、念のため防御的に
//     確認する）。
//   - Authorizationヘッダー: 「Authorization: BEARER {token}」の例が
//     示されている（HTTP認証スキーム名は大文字小文字を区別しない
//     （RFC 7235 §2.1）ため、この実装では他のConcur API呼び出し例
//     （getting-started.markdown）や`token_type`フィールド自体の表記に
//     揃えて "Bearer" と表記する）。
//   - ベースURL（geolocation）: OAuth2 apidoc.markdownの
//     「When your application calls another API ... the request should be
//     made using the base URI specified in the geolocation value of the
//     response.」に基づき、トークンレスポンスのgeolocation値
//     （例: "https://us.api.concursolutions.com"）をそのままベースURLとして
//     使う（固定のUS/EMEA等のURLをこちらで決め打ちしない）。
//
// 【SCIM filter値のエスケープについて】
// SCIM（RFC 7644）のfilter文字列はダブルクォートで値を囲む構文のため、
// 値自体にダブルクォート・バックスラッシュが含まれる場合は先にエスケープ
// してからfilter文字列へ組み込む。その上で、filter文字列全体をURLの
// クエリパラメータとしてURLSearchParamsへ渡し、パーセントエンコードは
// URLSearchParams自身に行わせる（手動での文字列連結によるURL構築は行わない）。
const IDENTITY_USERS_PATH = "/profile/identity/v4/Users";

function escapeScimFilterValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * @param {object} input
 * @param {string} input.geolocation トークンレスポンスのgeolocation値（ベースURL）。
 * @param {string} input.accessToken 取得済みのAccess Token（呼び出し元が破棄まで管理する）。
 * @param {string} input.userName 検索対象のConcurログインID（事前にtrim・検証済みであること）。
 * @returns {{ url: string, method: "GET", headers: Record<string,string> }}
 */
export function buildConcurIdentityLookupRequest({ geolocation, accessToken, userName }) {
  const params = new URLSearchParams({
    filter: `userName eq "${escapeScimFilterValue(userName)}"`,
    attributes: "id",
    count: "2",
  });

  return {
    url: `${stripTrailingSlash(geolocation)}${IDENTITY_USERS_PATH}?${params.toString()}`,
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
}
