// 管理画面「Concurマッピング」の新規追加・編集フォーム専用の、入力1件分の検証。
// 一意性判定（companyId+policyId+botExpenseTypeId）は、実行時解決
// （concurExpenseTypeMapping.js の mapBotExpenseTypeToConcur）・初期設定Excel
// インポート時の重複検出（parseInitialSetupExcel.js）と同じ mappingMatchesKey() を
// 再利用する。「何をもって同じmappingとみなすか」の判定ロジックをUI側へ
// 別途コピーしない。
//
// 実際のConcur Expense Type Codeの形式（数字限定・桁数固定・prefix必須等）は
// まだ確定していないため、ここでは「空でないこと」以上の形式チェックは行わない。
import { mappingMatchesKey } from "./concurExpenseTypeMapping";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// 表示名の解決。存在しないIDが渡された場合（参照先のポリシー・経費タイプが
// 後から削除された等）でも例外にせず、IDそのものをフォールバック表示する
// （ExpenseTypeSettings.jsxが既存で行っている
// `policies.find(...)?.policy_name || expenseType.policyId` と同じ考え方）。
export function resolvePolicyName(policies, policyId) {
  return (policies || []).find((policy) => policy.policy_id === policyId)?.policy_name || policyId;
}

export function resolveExpenseTypeName(expenseTypes, botExpenseTypeId) {
  return (expenseTypes || []).find((expenseType) => expenseType.id === botExpenseTypeId)?.name || botExpenseTypeId;
}

/**
 * 新規追加・編集フォームの入力1件を検証し、問題が無ければ保存用に正規化した
 * mappingオブジェクトを返す。
 *
 * @param {object} input
 * @param {string} input.companyId 現在編集中の会社ID（ユーザー入力させない。呼び出し側が固定値で渡す）。
 * @param {string} input.policyId フォームで選択されたポリシーID。
 * @param {string} input.botExpenseTypeId フォームで選択された経費タイプID。
 * @param {string} input.concurExpenseTypeId フォームに入力されたConcur Expense Type Code。
 * @param {Array} input.policies 現在のworkspace state（editor.policies）。
 * @param {Array} input.expenseTypes 現在のworkspace state（editor.expenseTypes）。
 * @param {Array} input.existingMappings 現在のworkspace state（editor.concurExpenseTypeMappings）。
 * @param {{companyId,policyId,botExpenseTypeId}=} input.excludeKey
 *   編集時、編集対象自身の「変更前のキー」を渡すと、自分自身を重複判定から除外する
 *   （キーを変更しない編集で「自分自身と重複している」と誤検知しないため）。
 *
 * @returns {{ error: {type:string, message:string} | null, mapping?: object }}
 */
export function validateConcurExpenseTypeMappingInput({
  companyId,
  policyId,
  botExpenseTypeId,
  concurExpenseTypeId,
  policies,
  expenseTypes,
  existingMappings,
  excludeKey,
} = {}) {
  const trimmedPolicyId = text(policyId);
  const trimmedBotExpenseTypeId = text(botExpenseTypeId);
  const trimmedConcurExpenseTypeId = text(concurExpenseTypeId);

  if (!trimmedPolicyId) {
    return { error: { type: "policy_required", message: "ポリシーを選択してください。" } };
  }

  const policy = (policies || []).find((item) => item.policy_id === trimmedPolicyId);
  if (!policy) {
    return { error: { type: "policy_unknown", message: "選択したポリシーが見つかりません。" } };
  }

  if (!trimmedBotExpenseTypeId) {
    return { error: { type: "expense_type_required", message: "経費タイプを選択してください。" } };
  }

  const expenseType = (expenseTypes || []).find((item) => item.id === trimmedBotExpenseTypeId);
  if (!expenseType) {
    return { error: { type: "expense_type_unknown", message: "選択した経費タイプが見つかりません。" } };
  }

  if (expenseType.policyId !== trimmedPolicyId) {
    return {
      error: {
        type: "policy_expense_type_mismatch",
        message: "選択した経費タイプは、指定したポリシーに属していません。",
      },
    };
  }

  if (!trimmedConcurExpenseTypeId) {
    return { error: { type: "concur_code_required", message: "Concur Expense Type Codeを入力してください。" } };
  }

  const candidateKey = {
    companyId,
    policyId: trimmedPolicyId,
    botExpenseTypeId: trimmedBotExpenseTypeId,
  };

  const isDuplicate = (existingMappings || []).some((mapping) => {
    if (excludeKey && mappingMatchesKey(mapping, excludeKey)) {
      return false;
    }
    return mappingMatchesKey(mapping, candidateKey);
  });

  if (isDuplicate) {
    return {
      error: {
        type: "duplicate_mapping",
        message: "同じポリシー・経費タイプの組み合わせのマッピングが既に登録されています。",
      },
    };
  }

  return {
    error: null,
    mapping: {
      companyId,
      policyId: trimmedPolicyId,
      botExpenseTypeId: trimmedBotExpenseTypeId,
      concurExpenseTypeId: trimmedConcurExpenseTypeId,
    },
  };
}

/**
 * 経費タイプ編集画面（ExpenseTypeSettings.jsx）で「ポリシー」を変更しようとした
 * 時に、確認ダイアログを挟むべきかどうかを判定する。
 *
 * 既存のConcurマッピング（companyId+policyId+botExpenseTypeIdが一意キー）は、
 * ポリシー変更時に自動的には書き換えない（同じConcurコードが新ポリシーでも
 * 使えるとは限らない、外部システム設定を推測で変更すべきではないため）。
 * その代わり、この経費タイプが1件以上のConcurマッピングから参照されている
 * 場合だけ、変更前に管理者へ確認を求める。ポリシーを実際には変更しない編集
 * （選択したまま・同じ値を選び直した等）では確認不要。
 *
 * @param {{currentPolicyId: string, nextPolicyId: string, concurMappingUsage: number}} input
 * @returns {boolean} trueなら確認ダイアログを表示すべき。
 */
export function shouldConfirmExpenseTypePolicyChange({ currentPolicyId, nextPolicyId, concurMappingUsage }) {
  if (nextPolicyId === currentPolicyId) {
    return false;
  }
  return (concurMappingUsage || 0) > 0;
}
