// company / policies / expenseTypes / concurExpenseTypeMappings に対する単純な
// 状態遷移（純粋関数）。flowMutations.js と同じ方針：ここではバリデーションは
// 行わない（一意性・参照整合性は入力側フォーム＝src/lib/concurMappingValidation.js
// での事前チェックと masterDataChecks.js に任せる）。
import { mappingMatchesKey } from "../lib/concurExpenseTypeMapping";

export function updateCompanyName(company, name) {
  return { ...company, company_name: name };
}

export function addPolicy(policies, policy) {
  return [...policies, policy];
}

export function updatePolicy(policies, policyId, patch) {
  return policies.map((policy) =>
    policy.policy_id === policyId ? { ...policy, ...patch } : policy,
  );
}

export function deletePolicy(policies, policyId) {
  return policies.filter((policy) => policy.policy_id !== policyId);
}

export function addExpenseType(expenseTypes, expenseType) {
  return [...expenseTypes, expenseType];
}

export function updateExpenseType(expenseTypes, expenseTypeId, patch) {
  return expenseTypes.map((expenseType) =>
    expenseType.id === expenseTypeId ? { ...expenseType, ...patch } : expenseType,
  );
}

export function deleteExpenseType(expenseTypes, expenseTypeId) {
  return expenseTypes.filter((expenseType) => expenseType.id !== expenseTypeId);
}

// --- Concur Expense Type Mapping -----------------------------------------
//
// mapping自体は policy.policy_id / expenseType.id のような、それ単体で一意な
// idフィールドを持たない（正とするデータ構造は companyId+policyId+
// botExpenseTypeId+concurExpenseTypeId の4フィールドのみで、管理用の内部idを
// 追加しない方針のため）。そのため update/delete は「対象を一意に特定する
// キー（変更前のcompanyId+policyId+botExpenseTypeId）」を受け取り、
// mappingMatchesKey() で該当行を探す。

export function addConcurExpenseTypeMapping(concurExpenseTypeMappings, mapping) {
  return [...concurExpenseTypeMappings, mapping];
}

export function updateConcurExpenseTypeMapping(concurExpenseTypeMappings, targetKey, patch) {
  return concurExpenseTypeMappings.map((mapping) =>
    mappingMatchesKey(mapping, targetKey) ? { ...mapping, ...patch } : mapping,
  );
}

export function deleteConcurExpenseTypeMapping(concurExpenseTypeMappings, targetKey) {
  return concurExpenseTypeMappings.filter((mapping) => !mappingMatchesKey(mapping, targetKey));
}

// --- 利用状況の計算（削除・使用停止時の安全確認に使う） ---

export function countExpenseTypesUsingPolicy(expenseTypes, policyId) {
  return expenseTypes.filter((expenseType) => expenseType.policyId === policyId).length;
}

export function countFlowResultsUsingExpenseType(flow, expenseTypeId) {
  let count = 0;

  Object.values(flow.options).forEach((option) => {
    if (option.next?.type !== "result") {
      return;
    }
    (option.next.candidates || []).forEach((candidate) => {
      if (candidate.expenseTypeId === expenseTypeId) {
        count += 1;
      }
    });
  });

  return count;
}

// ポリシー・経費タイプの削除確認時に、Concurマッピングが参照しているかどうかを
// 表示するための件数計算（countExpenseTypesUsingPolicy等と同じ考え方）。
export function countConcurMappingsUsingPolicy(concurExpenseTypeMappings, policyId) {
  return (concurExpenseTypeMappings || []).filter((mapping) => mapping.policyId === policyId).length;
}

export function countConcurMappingsUsingExpenseType(concurExpenseTypeMappings, botExpenseTypeId) {
  return (concurExpenseTypeMappings || []).filter((mapping) => mapping.botExpenseTypeId === botExpenseTypeId)
    .length;
}
