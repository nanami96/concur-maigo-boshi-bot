// company / policies / expenseTypes に対する単純な状態遷移（純粋関数）。
// flowMutations.js と同じ方針：ここではバリデーションは行わない
// （一意性・参照整合性は入力側フォームでの事前チェックと masterDataChecks.js に任せる）。

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
