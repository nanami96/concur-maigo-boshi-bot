import { useState } from "react";
import OptionMenu from "./OptionMenu";
import ConfirmDialog from "./ConfirmDialog";
import {
  validateConcurExpenseTypeMappingInput,
  resolvePolicyName,
  resolveExpenseTypeName,
} from "../lib/concurMappingValidation";

// 指定したポリシーIDに属する経費タイプだけを候補にする（経費タイプ側の既存
// policyIdフィールドをそのまま使う。ExpenseTypeSettings.jsxの経費タイプ編集フォームと
// 同じ「ポリシーに紐づく経費タイプ」という考え方）。
function expenseTypesForPolicy(expenseTypes, policyId) {
  return (expenseTypes || []).filter((expenseType) => expenseType.policyId === policyId);
}

// ポリシー・経費タイプ・Concur Expense Type Codeの3項目を入力するフォーム本体
// （新規追加・編集の両方で使う共通部品）。companyIdは常に呼び出し側から固定値で
// 渡され、この中には一切入力欄を用意しない。
function ConcurMappingFields({ policies, expenseTypes, policyId, botExpenseTypeId, concurExpenseTypeId, onChange }) {
  const availableExpenseTypes = expenseTypesForPolicy(expenseTypes, policyId);

  function handlePolicyChange(nextPolicyId) {
    const nextAvailable = expenseTypesForPolicy(expenseTypes, nextPolicyId);
    const nextBotExpenseTypeId = nextAvailable.some((expenseType) => expenseType.id === botExpenseTypeId)
      ? botExpenseTypeId
      : nextAvailable[0]?.id || "";
    onChange({ policyId: nextPolicyId, botExpenseTypeId: nextBotExpenseTypeId, concurExpenseTypeId });
  }

  return (
    <>
      <label className="flowFieldLabel">
        ポリシー
        <span className="settingsSelectWrap">
          <select
            className="settingsSelectInput"
            value={policyId}
            onChange={(event) => handlePolicyChange(event.target.value)}
          >
            <option value="" disabled>
              選択してください
            </option>
            {policies.map((policy) => (
              <option key={policy.policy_id} value={policy.policy_id}>
                {policy.policy_name}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="flowFieldLabel">
        経費タイプ
        <span className="settingsSelectWrap">
          <select
            className="settingsSelectInput"
            value={botExpenseTypeId}
            disabled={!policyId}
            onChange={(event) =>
              onChange({ policyId, botExpenseTypeId: event.target.value, concurExpenseTypeId })
            }
          >
            <option value="" disabled>
              {policyId ? "選択してください" : "先にポリシーを選択してください"}
            </option>
            {availableExpenseTypes.map((expenseType) => (
              <option key={expenseType.id} value={expenseType.id}>
                {expenseType.name}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="flowFieldLabel">
        Concur Expense Type Code
        <input
          className="settingsTextInput"
          value={concurExpenseTypeId}
          onChange={(event) => onChange({ policyId, botExpenseTypeId, concurExpenseTypeId: event.target.value })}
          placeholder="Concur側で確認したコードを入力"
        />
      </label>
    </>
  );
}

function ConcurMappingRow({ mapping, editor, companyId }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [confirmRequest, setConfirmRequest] = useState(null);

  const policyName = resolvePolicyName(editor.policies, mapping.policyId);
  const expenseTypeName = resolveExpenseTypeName(editor.expenseTypes, mapping.botExpenseTypeId);

  function startEditing() {
    setDraft({
      policyId: mapping.policyId,
      botExpenseTypeId: mapping.botExpenseTypeId,
      concurExpenseTypeId: mapping.concurExpenseTypeId,
    });
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setDraft(null);
    setError(null);
  }

  function handleSave() {
    const { error: validationError, mapping: normalizedMapping } = validateConcurExpenseTypeMappingInput({
      companyId,
      policyId: draft.policyId,
      botExpenseTypeId: draft.botExpenseTypeId,
      concurExpenseTypeId: draft.concurExpenseTypeId,
      policies: editor.policies,
      expenseTypes: editor.expenseTypes,
      existingMappings: editor.concurExpenseTypeMappings,
      excludeKey: { companyId: mapping.companyId, policyId: mapping.policyId, botExpenseTypeId: mapping.botExpenseTypeId },
    });

    if (validationError) {
      setError(validationError.message);
      return;
    }

    editor.updateConcurExpenseTypeMapping(
      { companyId: mapping.companyId, policyId: mapping.policyId, botExpenseTypeId: mapping.botExpenseTypeId },
      normalizedMapping,
    );
    setIsEditing(false);
    setDraft(null);
    setError(null);
  }

  function handleDelete() {
    setConfirmRequest({
      title: "Concurマッピングを削除しますか？",
      message: `「${policyName} / ${expenseTypeName}」のマッピングを削除します。`,
      confirmLabel: "削除する",
      onConfirm: () =>
        editor.deleteConcurExpenseTypeMapping({
          companyId: mapping.companyId,
          policyId: mapping.policyId,
          botExpenseTypeId: mapping.botExpenseTypeId,
        }),
    });
  }

  const menuItems = [
    { label: isEditing ? "編集を閉じる" : "編集", onClick: () => (isEditing ? cancelEditing() : startEditing()) },
    { label: "削除", danger: true, onClick: handleDelete },
  ];

  const confirmDialog = (
    <ConfirmDialog
      request={confirmRequest}
      onConfirm={() => {
        confirmRequest?.onConfirm();
        setConfirmRequest(null);
      }}
      onCancel={() => setConfirmRequest(null)}
    />
  );

  if (!isEditing) {
    return (
      <tr>
        <td>{policyName}</td>
        <td>{expenseTypeName}</td>
        <td>{mapping.concurExpenseTypeId}</td>
        <td className="settingsTableMenuCell">
          <OptionMenu items={menuItems} />
          {confirmDialog}
        </td>
      </tr>
    );
  }

  return (
    <tr className="settingsEditingRow">
      <td colSpan={4}>
        <div className="settingsCardDetail">
          <ConcurMappingFields
            policies={editor.policies}
            expenseTypes={editor.expenseTypes}
            policyId={draft.policyId}
            botExpenseTypeId={draft.botExpenseTypeId}
            concurExpenseTypeId={draft.concurExpenseTypeId}
            onChange={setDraft}
          />

          {error && <p className="settingsErrorText">{error}</p>}

          <div className="settingsAddFormActions">
            <button type="button" className="flowGhostButton" onClick={cancelEditing}>
              キャンセル
            </button>
            <button type="button" className="importConfirmButton" onClick={handleSave}>
              保存する
            </button>
          </div>
        </div>
        {confirmDialog}
      </td>
    </tr>
  );
}

function AddConcurMappingForm({ editor, companyId, onDone }) {
  const [draft, setDraft] = useState({ policyId: "", botExpenseTypeId: "", concurExpenseTypeId: "" });
  const [error, setError] = useState(null);

  function handleSubmit() {
    const { error: validationError, mapping } = validateConcurExpenseTypeMappingInput({
      companyId,
      policyId: draft.policyId,
      botExpenseTypeId: draft.botExpenseTypeId,
      concurExpenseTypeId: draft.concurExpenseTypeId,
      policies: editor.policies,
      expenseTypes: editor.expenseTypes,
      existingMappings: editor.concurExpenseTypeMappings,
    });

    if (validationError) {
      setError(validationError.message);
      return;
    }

    editor.addConcurExpenseTypeMapping(mapping);
    onDone();
  }

  return (
    <div className="settingsCard settingsAddForm">
      <ConcurMappingFields
        policies={editor.policies}
        expenseTypes={editor.expenseTypes}
        policyId={draft.policyId}
        botExpenseTypeId={draft.botExpenseTypeId}
        concurExpenseTypeId={draft.concurExpenseTypeId}
        onChange={setDraft}
      />

      {error && <p className="settingsErrorText">{error}</p>}

      <div className="settingsAddFormActions">
        <button type="button" className="flowGhostButton" onClick={onDone}>
          キャンセル
        </button>
        <button type="button" className="importConfirmButton" onClick={handleSubmit}>
          追加する
        </button>
      </div>
    </div>
  );
}

// Concur Expense Type Mapping専用の設定画面。既存のPolicySettings.jsx／
// ExpenseTypeSettings.jsxと同じUIパターン（一覧テーブル＋OptionMenuでの編集/削除＋
// 追加フォーム）を踏襲しつつ、経費タイプ編集画面自体には一切項目を追加しない
// （関心事を分離する、という調査フェーズでの設計方針をそのまま踏襲）。
//
// companyIdは現在編集中の会社（editor.company.company_id）から固定で取得し、
// このコンポーネント内のどのフォームにもcompanyIdの入力欄は用意しない。
export default function ConcurMappingSettings({ editor }) {
  const [isAdding, setIsAdding] = useState(false);
  const companyId = editor.company?.company_id;
  const mappings = editor.concurExpenseTypeMappings || [];

  if (editor.policies.length === 0 || editor.expenseTypes.length === 0) {
    return (
      <div className="settingsPanel">
        <h2>Concurマッピング</h2>
        <p className="flowEmptyOptionsHint">
          先にポリシー・経費タイプを1件以上作成してください。
        </p>
      </div>
    );
  }

  const isEmpty = mappings.length === 0;

  return (
    <div className="settingsPanel">
      <h2>Concurマッピング</h2>
      <p className="settingsCardMeta">
        迷子ボットの経費タイプとConcur側の経費タイプコードを対応付けます。Concur連携を使わない場合は登録不要です。
      </p>

      {isEmpty && !isAdding && (
        <p className="flowEmptyOptionsHint">Concurマッピングはまだ登録されていません。</p>
      )}

      {!isEmpty && (
        <div className="settingsTableWrap">
          <table className="settingsTable">
            <thead>
              <tr>
                <th>ポリシー</th>
                <th>経費タイプ</th>
                <th>Concur Expense Type Code</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping, index) => (
                <ConcurMappingRow
                  // mapping自体はcompanyId+policyId+botExpenseTypeIdの組が一意キー
                  // （src/lib/concurExpenseTypeMapping.jsのmappingMatchesKey参照）。
                  key={`${mapping.companyId}-${mapping.policyId}-${mapping.botExpenseTypeId}-${index}`}
                  mapping={mapping}
                  editor={editor}
                  companyId={companyId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdding ? (
        <AddConcurMappingForm editor={editor} companyId={companyId} onDone={() => setIsAdding(false)} />
      ) : (
        <button type="button" className="flowAddOptionButton" onClick={() => setIsAdding(true)}>
          {isEmpty ? "＋ 最初のConcurマッピングを追加" : "＋ Concurマッピングを追加"}
        </button>
      )}
    </div>
  );
}
