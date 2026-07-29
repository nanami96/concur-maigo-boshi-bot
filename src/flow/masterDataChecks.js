// company / policies / expenseTypes / concurExpenseTypeMappings まわりの設定チェック。
// flowChecks.js が見ている「質問・選択肢・結果」の構造的な整合性はそちらに任せ、
// ここでは基本設定・ポリシー・経費タイプ自体の妥当性と、経費タイプ↔ポリシーの整合性、
// 経費タイプの使用停止状態と質問フローの利用状況の食い違い、Concurマッピングの
// 参照整合性・一意性だけを見る。
import { countFlowResultsUsingExpenseType } from "./masterDataMutations";
import { mappingMatchesKey } from "../lib/concurExpenseTypeMapping";

function issue(level, id, message, target) {
  return { level, id, message, target };
}

// Concurマッピングは会社によっては1件も使わない（Concur連携を使わない会社が
// 存在する）ため、「0件であること」自体・「一部の経費タイプにmappingが無いこと」
// 自体は一切エラー・警告にしない（Concur連携対象範囲は会社ごとに未確定のため）。
// 参照整合性（存在しないpolicyId/botExpenseTypeId、policyId不一致）・一意性
// （companyId+policyId+botExpenseTypeIdの重複）・値の欠落（concurExpenseTypeIdが
// 空）という、mapping自体がおかしいと言えるケースだけを検出する。
function checkConcurExpenseTypeMappings({ policies, expenseTypes, concurExpenseTypeMappings }) {
  const errors = [];
  const mappings = concurExpenseTypeMappings || [];
  const policyById = new Map(policies.map((policy) => [policy.policy_id, policy]));
  const expenseTypeById = new Map(expenseTypes.map((expenseType) => [expenseType.id, expenseType]));
  const seen = [];

  mappings.forEach((mapping, index) => {
    const label = `ポリシー「${mapping.policyId || "未設定"}」・経費タイプ「${mapping.botExpenseTypeId || "未設定"}」`;

    const policy = policyById.get(mapping.policyId);
    if (!policy) {
      errors.push(
        issue(
          "error",
          `concur-mapping-policy-missing-${index}`,
          `Concurマッピング（${label}）が参照しているポリシーが見つかりません。`,
          "concurMapping",
        ),
      );
    }

    const expenseType = expenseTypeById.get(mapping.botExpenseTypeId);
    if (!expenseType) {
      errors.push(
        issue(
          "error",
          `concur-mapping-expense-type-missing-${index}`,
          `Concurマッピング（${label}）が参照している経費タイプが見つかりません。`,
          "concurMapping",
        ),
      );
    } else if (policy && expenseType.policyId !== mapping.policyId) {
      errors.push(
        issue(
          "error",
          `concur-mapping-policy-mismatch-${index}`,
          `Concurマッピング（${label}）: 経費タイプ「${expenseType.name}」が属するポリシーと、マッピングで指定されているポリシーが一致しません。`,
          "concurMapping",
        ),
      );
    }

    if (!mapping.concurExpenseTypeId || !String(mapping.concurExpenseTypeId).trim()) {
      errors.push(
        issue(
          "error",
          `concur-mapping-code-empty-${index}`,
          `Concurマッピング（${label}）のConcur Expense Type Codeが空です。`,
          "concurMapping",
        ),
      );
    }

    if (seen.some((existing) => mappingMatchesKey(existing, mapping))) {
      errors.push(
        issue(
          "error",
          `concur-mapping-duplicate-${index}`,
          `Concurマッピング（${label}）が重複しています。`,
          "concurMapping",
        ),
      );
    }
    seen.push(mapping);
  });

  return { errors };
}

export function checkMasterData({ company, policies, expenseTypes, flow, concurExpenseTypeMappings }) {
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

  const concurMappingResult = checkConcurExpenseTypeMappings({ policies, expenseTypes, concurExpenseTypeMappings });

  return { errors: [...errors, ...concurMappingResult.errors], warnings };
}
