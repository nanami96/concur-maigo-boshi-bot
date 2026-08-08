// refreshConcurAccessToken()が返す検証済みtokens.scope（OAuth Tokenレスポンスの
// scope文字列）に、Quick Expense/Identity連携で必要な特定のscopeが実際に
// 含まれているかどうかを、真偽値だけで安全に判定する純粋関数。
//
// 【根拠（公式ドキュメントのみ）】
// - quickexpense.writeonly … Quick Expense v4公式ドキュメント
//   （api-reference/expense/quick-expense/v4.quick-expense.md）の
//   Scope Usageテーブル："Write quick expense."（POST、必須スコープ）
// - user.read … 同ドキュメントのScope Usageテーブル："Get User Information,
//   necessary for userID."（userID取得に必要と記載されているスコープ）
// - identity.user.ids.read … Identity v4公式ドキュメント
//   （api-reference/profile/v4.identity.md）のスコープ表："Read user ID
//   data."（本プロジェクトのlookup-concur-userが実際に使用中のスコープ）
// - receipts.writeonly … Quick Expense v4公式ドキュメント（同上ページ）の
//   Scope Usageテーブルで、画像付きQuick Expense作成
//   （POST .../quickexpenses/image）の必須スコープとして記載
//   （Phase 14公式API調査で確認。このスコープ自体はまだどのEdge Function
//   からも実際のConcur通信で使われていない＝今回は「確認できるようにする」
//   だけで、画像送信本体の実装はまだ行わない）。
//
// 【判定方法】
// scope文字列を半角空白等（連続する空白文字全般。タブ・改行を含む）で分割し、
// 各スコープ名との完全一致だけを見る（部分一致・前方一致・大文字小文字の
// 違いは一致とみなさない）。
//
// 【scope未返却の扱いについて】
// tokenレスポンスにscope自体が含まれない場合（任意項目のため）と、
// scopeはあるが対象のスコープ名が含まれない場合とでは意味が異なる
// （前者は「確認できていない」、後者は「確認した結果、不足している」）。
// この違いを呼び出し元・利用者が区別できるよう、scopePresentを別途返す
// （3つの真偽値だけにまとめてしまうと、両者が同じfalseになり誤解を招く
// ため）。scopePresentがfalseの場合、3つの真偽値は安全側で常にfalseとする
// （「確認できていないのに権限ありと誤って表示する」ことを避けるため）。
//
// 戻り値にはscopeの生値・件数・他のスコープ名は一切含めない。
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

const REQUIRED_SCOPE_NAMES = {
  hasQuickExpenseWriteScope: "quickexpense.writeonly",
  hasUserReadScope: "user.read",
  hasIdentityUserIdsReadScope: "identity.user.ids.read",
  hasReceiptsWriteScope: "receipts.writeonly",
};

/**
 * @param {string | null | undefined} scope refreshConcurAccessToken()のtokens.scope。
 * @returns {{
 *   scopePresent: boolean,
 *   hasQuickExpenseWriteScope: boolean,
 *   hasUserReadScope: boolean,
 *   hasIdentityUserIdsReadScope: boolean,
 *   hasReceiptsWriteScope: boolean,
 * }}
 */
export function evaluateConcurRequiredScopes(scope) {
  const scopePresent = isNonEmptyString(scope);
  const scopeList = scopePresent ? scope.trim().split(/\s+/) : [];

  const result = { scopePresent };
  for (const [resultKey, scopeName] of Object.entries(REQUIRED_SCOPE_NAMES)) {
    result[resultKey] = scopePresent && scopeList.includes(scopeName);
  }
  return result;
}
