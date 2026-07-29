// フロントから送られたexpenseTypeId・policyIdをそのまま信用せず、その会社の
// 公開済み設定（config_snapshot.expenseTypes）に実在する経費タイプかどうかを
// 検証する純粋関数。
//
// 経費タイプID＝Concur EXP_KEYという設計への正式リファクタリングにより、
// 以前はここで別テーブル（Concur Expense Type Mapping、companyId+policyId+
// botExpenseTypeId→concurExpenseTypeIdの対応表）と照合していたが
// （旧verifyConcurExpenseTypeMapping.js）、経費タイプのidそのものがConcur側の
// 識別子であるため、公開済みexpenseTypes配列に対して直接照合するだけでよい。
//
// 検証する項目（Commit Gで確立したcompanyId＝company_codeの照合とは別軸）：
//   1. expenseTypeIdが存在すること（企業の公開済み経費タイプ一覧に無ければ拒否）
//   2. その経費タイプのpolicyIdが、リクエストのpolicyIdと一致すること
//      （フロントが別ポリシーのIDを詐称して送ってきた場合に拒否するため）
//   3. その経費タイプが使用停止（active===false）でないこと
//
// 上記いずれの理由であっても、戻り値のreasonは同じ "not_found" にまとめる
// （どの条件で失敗したかを外部呼び出し元へ伝えると、どの値が間違っているかの
// 手がかり（オラクル）を与えてしまうため。旧verifyConcurExpenseTypeMapping.jsの
// 「3キー不一致」と「concurExpenseTypeIdだけ不一致」を同じreasonにまとめていた
// のと同じ考え方）。
function toText(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {object} input
 * @param {Array<{ id: string, policyId: string, active?: boolean }>} input.expenseTypes
 *   公開済みconfig_snapshot.expenseTypes（resolveMembershipFromPublicConfigRow.js参照）。
 * @param {string} input.expenseTypeId リクエスト本文のexpenseTypeId（Concur EXP_KEY）。
 * @param {string} input.policyId リクエスト本文のpolicyId。
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function verifyExpenseTypeForQuickExpense({ expenseTypes, expenseTypeId, policyId }) {
  const entries = Array.isArray(expenseTypes) ? expenseTypes : [];
  const match = entries.find((entry) => toText(entry?.id) === expenseTypeId);

  if (!match) {
    return { valid: false, reason: "not_found" };
  }

  if (toText(match.policyId) !== policyId) {
    return { valid: false, reason: "not_found" };
  }

  if (match.active === false) {
    return { valid: false, reason: "not_found" };
  }

  return { valid: true, reason: null };
}
