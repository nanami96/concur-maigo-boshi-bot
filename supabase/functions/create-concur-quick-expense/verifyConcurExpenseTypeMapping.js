// フロントから送られたpolicyId・botExpenseTypeId・concurExpenseTypeIdを
// そのまま信用せず、認証済みユーザーの所属会社が実際に公開している
// Concur Expense Type Mapping（get_my_public_config()のconfig_snapshot.concur.
// expenseTypeMappings、resolveMembershipFromPublicConfigRow.js参照）と
// 完全一致するかどうかだけを確認する、Deno/Supabaseに依存しない純粋関数。
//
// なぜsrc/lib/concurExpenseTypeMapping.jsのmappingMatchesKey()をそのまま
// importして再利用しないか（意図的な複製）：
//   ロジック自体（companyId+policyId+botExpenseTypeIdの3キー一致）は
//   Deno互換のプレーンなJSで技術的には再利用可能だが、Supabase Edge
//   Functionのデプロイは`supabase/functions/<関数名>`ディレクトリの外側
//   （このプロジェクトのフロントであるsrc/配下）を含まないため、
//   src/lib/を直接importするとローカルのテスト実行では動いても、実際に
//   `supabase functions deploy`した後には解決できなくなる。
//   src/data/concurApi.jsのclassifyQuickExpenseFunctionError()が既存の
//   classifyOcrFunctionError()をあえて複製しているのと同じ理由・同じ方針
//   （動作検証済みの既存コードを不用意に共有・変更しないためでもある）。
//   3キーの一致判定ロジックが将来変わった場合は、この関数と
//   src/lib/concurExpenseTypeMapping.jsのmappingMatchesKey()の両方を
//   同時に見直す必要がある（意図的なトレードオフ）。
//
// このEdge Function独自の要件として、3キーだけでなくconcurExpenseTypeId
// 自体も一致するかを確認する点がmappingMatchesKey()と異なる
// （mappingMatchesKey()は「同一のmappingかどうか」の判定用であり、
// concurExpenseTypeIdはそもそも比較対象に含まれない設計。ここでは逆に
// 「フロントが申告したConcur側コードが、実際に登録されているコードと
// 一致するか」を確認したいため、4項目すべてを見る）。

function matchesKey(entry, key) {
  return (
    entry?.companyId === key.companyId &&
    entry?.policyId === key.policyId &&
    entry?.botExpenseTypeId === key.botExpenseTypeId
  );
}

/**
 * @param {object} input
 * @param {unknown} input.mappings config_snapshot.concur.expenseTypeMappings
 *   に相当する値。配列であることを保証しない（壊れた設定・未設定でも
 *   例外にせず、単に「一致なし」として扱う）。
 * @param {string} input.companyId
 * @param {string} input.policyId
 * @param {string} input.botExpenseTypeId
 * @param {string} input.concurExpenseTypeId
 *
 * @returns {{ valid: boolean, reason: "not_found" | "conflict" | null }}
 *   valid: trueなら、4項目に完全一致する正規のmappingが1件だけ存在する。
 *   reason:
 *     - "not_found" … 一致する行が0件、または3キー(companyId/policyId/
 *       botExpenseTypeId)は一致するがconcurExpenseTypeIdだけが異なる
 *       （両者を呼び出し元へ区別して見せない。詳細を返すと、外部から
 *       「どの項目まで正解に近いか」を推測する材料を与えてしまうため）。
 *     - "conflict" … 同じ3キーの行が複数存在する（本来あってはならない
 *       設定データの不整合。安全側に倒して拒否する）。
 */
export function verifyConcurExpenseTypeMapping({
  mappings,
  companyId,
  policyId,
  botExpenseTypeId,
  concurExpenseTypeId,
}) {
  const entries = Array.isArray(mappings) ? mappings : [];
  const key = { companyId, policyId, botExpenseTypeId };

  const keyMatches = entries.filter((entry) => matchesKey(entry, key));

  if (keyMatches.length === 0) {
    return { valid: false, reason: "not_found" };
  }

  if (keyMatches.length > 1) {
    return { valid: false, reason: "conflict" };
  }

  if (keyMatches[0]?.concurExpenseTypeId !== concurExpenseTypeId) {
    return { valid: false, reason: "not_found" };
  }

  return { valid: true, reason: null };
}
