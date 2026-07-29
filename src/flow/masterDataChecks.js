// company / policies / expenseTypes まわりの設定チェック。
// flowChecks.js が見ている「質問・選択肢・結果」の構造的な整合性はそちらに任せ、
// ここでは基本設定・ポリシー・経費タイプ自体の妥当性と、経費タイプ↔ポリシーの整合性、
// 経費タイプの使用停止状態と質問フローの利用状況の食い違いだけを見る。
import { countFlowResultsUsingExpenseType } from "./masterDataMutations";

function issue(level, id, message, target) {
  return { level, id, message, target };
}

export function checkMasterData({ company, policies, expenseTypes, flow }) {
  const errors = [];
  const warnings = [];

  if (!company || !company.company_name || !company.company_name.trim()) {
    errors.push(issue("error", "company-name-required", "会社名が設定されていません。", "company"));
  }

  const seenPolicyIds = new Set();
  policies.forEach((policy) => {
    if (seenPolicyIds.has(policy.policy_id)) {
      errors.push(
        issue(
          "error",
          `policy-id-dup-${policy.policy_id}`,
          `ポリシーID「${policy.policy_id}」が重複しています。`,
          "policies",
        ),
      );
    }
    seenPolicyIds.add(policy.policy_id);

    if (!policy.policy_name || !policy.policy_name.trim()) {
      errors.push(
        issue(
          "error",
          `policy-name-required-${policy.policy_id}`,
          `ポリシー（ID: ${policy.policy_id}）の名称が設定されていません。`,
          "policies",
        ),
      );
    }
  });

  const policyById = new Map(policies.map((policy) => [policy.policy_id, policy]));
  const seenExpenseIds = new Set();

  expenseTypes.forEach((expenseType) => {
    if (seenExpenseIds.has(expenseType.id)) {
      errors.push(
        issue(
          "error",
          `expense-id-dup-${expenseType.id}`,
          `経費タイプID「${expenseType.id}」が重複しています。`,
          "expenseTypes",
        ),
      );
    }
    seenExpenseIds.add(expenseType.id);

    if (!expenseType.name || !expenseType.name.trim()) {
      errors.push(
        issue(
          "error",
          `expense-name-required-${expenseType.id}`,
          `経費タイプ（ID: ${expenseType.id}）の名称が設定されていません。`,
          "expenseTypes",
        ),
      );
    }

    const policy = policyById.get(expenseType.policyId);
    if (!policy) {
      errors.push(
        issue(
          "error",
          `expense-policy-missing-${expenseType.id}`,
          `経費タイプ「${expenseType.name || expenseType.id}」が参照しているポリシーが見つかりません。`,
          "expenseTypes",
        ),
      );
      return;
    }

    if (expenseType.active && policy.enabled === "N") {
      warnings.push(
        issue(
          "warning",
          `expense-policy-disabled-${expenseType.id}`,
          `経費タイプ「${expenseType.name}」は使用中ですが、属するポリシー「${policy.policy_name}」は使用停止です。`,
          "policies",
        ),
      );
    }

    if (expenseType.receiptRequired === null || expenseType.receiptRequired === undefined) {
      warnings.push(
        issue(
          "warning",
          `expense-receipt-unset-${expenseType.id}`,
          `経費タイプ「${expenseType.name}」は領収書要否が未設定です。`,
          "expenseTypes",
        ),
      );
    }

    if (!expenseType.active && flow) {
      const usageCount = countFlowResultsUsingExpenseType(flow, expenseType.id);
      if (usageCount > 0) {
        warnings.push(
          issue(
            "warning",
            `expense-disabled-in-use-${expenseType.id}`,
            `経費タイプ「${expenseType.name}」は使用停止ですが、質問フロー内の${usageCount}件の結果でまだ参照されています。`,
            "expenseTypes",
          ),
        );
      }
    }
  });

  return { errors, warnings };
}
