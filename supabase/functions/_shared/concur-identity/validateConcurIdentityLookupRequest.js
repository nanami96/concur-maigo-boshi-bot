// lookup-concur-user（Edge Function本体はindex.ts）のリクエスト本文検証だけを
// 切り離した純粋関数。Deno固有のAPIには一切依存しないため、Node/vitestから
// 直接importしてテストできる（他のvalidate*Request.jsと同じ方針）。
//
// フィールド名について：公式ドキュメント（SAP Concur Identity v4
// api-reference/profile/v4.identity.md）のfilterパラメータが対応する
// 属性名がそのまま`userName`であるため、このEdge Functionのリクエスト本文
// フィールド名も`userName`に合わせる（Bot独自の名前を作らない）。
//
// 検証する項目：
//   - 必須（undefined・null等は拒否）
//   - 文字列型であること
//   - trim後に空でないこと
//   - 過度に長い値を拒否する：MAX_USER_NAME_LENGTHはConcur公式ドキュメントが
//     明示する上限ではない（ドキュメントには具体的な最大文字数の記載が
//     見つからなかった）。userNameは通常メールアドレス形式
//     （公式ドキュメントの例："user@domain"）であるため、メールアドレスの
//     事実上の上限として広く参照されるRFC 5321の320文字を、この
//     アプリケーション独自の防御的な上限として採用する（Concur側の公式な
//     制限値として断定しているわけではないことに注意）。
//   - Concur公式ドキュメントが明示する、userNameの値として使用できない
//     文字（"The following characters cannot be used as a value for this
//     record: % [ # ! * & ( ) ~ ' { ^ } \ / ? > < , ; : \" + = ], and
//     pipe."）を含む場合は拒否する（これは公式ドキュメントに明記された
//     事実であり、この禁止文字を弾くこと自体は推測ではない。副次的に、
//     SCIM filter文字列へ組み込む際の記号の混入も減らせる）。
//
// 失敗理由は区別せず、呼び出し元へは単一の固定コード
// （concur_identity_invalid_request）としてのみ伝える（入力値そのものは
// ログ・レスポンスへ一切含めない）。
const MAX_USER_NAME_LENGTH = 320;

// eslint-disable-next-line no-useless-escape -- 文字クラス内の記号を明示的に列挙するため
const FORBIDDEN_USER_NAME_CHARACTERS = /[%[\]#!*&()~'{^}\\/?><,;:"+=|]/;

// userName（ConcurログインID）1件分の値検証だけを切り出した部分。
// lookup-concur-user（本ファイルのvalidateConcurIdentityLookupRequest()）と、
// create-concur-quick-expense（ConcurログインIDをIdentity検索へ渡す前の検証）の
// 両方から同じ判定基準を再利用するために公開する（値の意味・禁止文字は
// Concur全体で共通のため、Edge Functionごとに別の基準を作らない）。
//
// @param {unknown} value
// @returns {{ ok: true, userName: string } | { ok: false }}
export function validateConcurUserNameValue(value) {
  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false };
  }

  if (trimmed.length > MAX_USER_NAME_LENGTH) {
    return { ok: false };
  }

  if (FORBIDDEN_USER_NAME_CHARACTERS.test(trimmed)) {
    return { ok: false };
  }

  return { ok: true, userName: trimmed };
}

/**
 * @param {unknown} body リクエスト本文をJSON.parseした値。
 * @returns {{ ok: true, userName: string } | { ok: false }}
 */
export function validateConcurIdentityLookupRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false };
  }

  return validateConcurUserNameValue(body.userName);
}
