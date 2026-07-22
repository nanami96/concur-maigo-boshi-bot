import { useMemo, useState } from "react";
import OptionMenu from "./OptionMenu";
import ConfirmDialog from "./ConfirmDialog";
import EditableText from "./EditableText";

function receiptLabel(value) {
  if (value === true) return "必要";
  if (value === false) return "不要";
  return "未設定";
}

function receiptToSelectValue(value) {
  if (value === true) return "required";
  if (value === false) return "not_required";
  return "unset";
}

function receiptFromSelectValue(value) {
  if (value === "required") return true;
  if (value === "not_required") return false;
  return null;
}

function ExpenseTypeRow({ expenseType, editor, policies }) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const policyName =
    policies.find((policy) => policy.policy_id === expenseType.policyId)?.policy_name ||
    expenseType.policyId;

  const handleDelete = () => {
    const usage = editor.computeExpenseTypeUsage(expenseType.id);
    if (usage > 0) {
      setConfirmRequest({
        title: "この経費タイプは使用中です",
        message: `この経費タイプは質問フロー内の${usage}件の結果で使用されています。削除すると質問フロー側の参照が壊れるため、まずは使用停止にすることをおすすめします。`,
        confirmLabel: "使用停止にする",
        onConfirm: () => editor.updateExpenseType(expenseType.id, { active: false }),
      });
      return;
    }

    setConfirmRequest({
      title: "経費タイプを削除しますか？",
      message: `「${expenseType.name}」を削除します。`,
      confirmLabel: "削除する",
      onConfirm: () => editor.deleteExpenseType(expenseType.id),
    });
  };

  const menuItems = [
    { label: isEditing ? "編集を閉じる" : "編集", onClick: () => setIsEditing((value) => !value) },
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
        <td>{expenseType.name}</td>
        <td>{policyName}</td>
        <td>{receiptLabel(expenseType.receiptRequired)}</td>
        <td>
          <span className={expenseType.active ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
            {expenseType.active ? "使用中" : "使用停止"}
          </span>
        </td>
        <td className="settingsTableMenuCell">
          <OptionMenu items={menuItems} />
          {confirmDialog}
        </td>
      </tr>
    );
  }

  return (
    <tr className="settingsEditingRow">
      <td colSpan={5}>
        <div className="settingsCardDetail">
          <label className="flowFieldLabel">
            経費タイプ名
            <EditableText
              className="settingsTextInput"
              value={expenseType.name}
              ariaLabel="経費タイプ名"
              onCommit={(name) => editor.updateExpenseType(expenseType.id, { name })}
            />
          </label>

          <label className="flowFieldLabel">
            ポリシー
            <span className="settingsSelectWrap">
              <select
                className="settingsSelectInput"
                value={expenseType.policyId}
                onChange={(event) => editor.updateExpenseType(expenseType.id, { policyId: event.target.value })}
              >
                {policies.map((policy) => (
                  <option key={policy.policy_id} value={policy.policy_id}>
                    {policy.policy_name}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="flowFieldLabel">
            領収書要否
            <span className="settingsSelectWrap">
              <select
                className="settingsSelectInput"
                value={receiptToSelectValue(expenseType.receiptRequired)}
                onChange={(event) =>
                  editor.updateExpenseType(expenseType.id, {
                    receiptRequired: receiptFromSelectValue(event.target.value),
                  })
                }
              >
                <option value="required">必要</option>
                <option value="not_required">不要</option>
                <option value="unset">未設定</option>
              </select>
            </span>
          </label>

          <label className="flowFieldLabel">
            使用有無
            <span className="settingsSelectWrap">
              <select
                className="settingsSelectInput"
                value={expenseType.active ? "Y" : "N"}
                onChange={(event) =>
                  editor.updateExpenseType(expenseType.id, { active: event.target.value === "Y" })
                }
              >
                <option value="Y">使用する</option>
                <option value="N">使用しない</option>
              </select>
            </span>
          </label>

          <p className="settingsHint">
            経費タイプID: <code>{expenseType.id}</code>（Concur側との突合キーのため作成後は変更できません）
          </p>

          <button type="button" className="flowGhostButton" onClick={() => setIsEditing(false)}>
            閉じる
          </button>
        </div>
        {confirmDialog}
      </td>
    </tr>
  );
}

function AddExpenseTypeForm({ editor, policies, onDone }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [policyId, setPolicyId] = useState(policies[0]?.policy_id || "");
  const [receipt, setReceipt] = useState("unset");
  const [enabled, setEnabled] = useState("Y");
  const [error, setError] = useState(null);

  const handleSubmit = () => {
    const trimmedId = id.trim();
    const trimmedName = name.trim();

    if (!trimmedId) {
      setError("経費タイプIDを入力してください。");
      return;
    }
    if (!trimmedName) {
      setError("経費タイプ名を入力してください。");
      return;
    }
    if (!policyId) {
      setError("ポリシーを選択してください。");
      return;
    }
    if (editor.expenseTypes.some((expenseType) => expenseType.id === trimmedId)) {
      setError(`経費タイプID「${trimmedId}」は既に使われています。`);
      return;
    }

    editor.addExpenseType({
      id: trimmedId,
      policyId,
      name: trimmedName,
      receiptRequired: receiptFromSelectValue(receipt),
      active: enabled === "Y",
      note: "",
    });
    onDone();
  };

  return (
    <div className="settingsCard settingsAddForm">
      <label className="flowFieldLabel">
        経費タイプID
        <input
          className="settingsTextInput"
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="例：taxi"
        />
      </label>
      <p className="settingsHint">
        Concurで使用している経費タイプコードがある場合は、その値を入力してください。
      </p>

      <label className="flowFieldLabel">
        経費タイプ名
        <input
          className="settingsTextInput"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例：タクシー"
        />
      </label>

      <label className="flowFieldLabel">
        ポリシー
        <span className="settingsSelectWrap">
          <select
            className="settingsSelectInput"
            value={policyId}
            onChange={(event) => setPolicyId(event.target.value)}
          >
            {policies.map((policy) => (
              <option key={policy.policy_id} value={policy.policy_id}>
                {policy.policy_name}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="flowFieldLabel">
        領収書要否
        <span className="settingsSelectWrap">
          <select
            className="settingsSelectInput"
            value={receipt}
            onChange={(event) => setReceipt(event.target.value)}
          >
            <option value="required">必要</option>
            <option value="not_required">不要</option>
            <option value="unset">未設定</option>
          </select>
        </span>
      </label>

      <label className="flowFieldLabel">
        使用有無
        <span className="settingsSelectWrap">
          <select
            className="settingsSelectInput"
            value={enabled}
            onChange={(event) => setEnabled(event.target.value)}
          >
            <option value="Y">使用する</option>
            <option value="N">使用しない</option>
          </select>
        </span>
      </label>

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

export default function ExpenseTypeSettings({ editor }) {
  const [keyword, setKeyword] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [receiptFilter, setReceiptFilter] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const filtered = useMemo(() => {
    return editor.expenseTypes.filter((expenseType) => {
      if (keyword && !expenseType.name.includes(keyword)) return false;
      if (policyFilter && expenseType.policyId !== policyFilter) return false;
      if (statusFilter === "active" && !expenseType.active) return false;
      if (statusFilter === "inactive" && expenseType.active) return false;
      if (receiptFilter === "required" && expenseType.receiptRequired !== true) return false;
      if (receiptFilter === "not_required" && expenseType.receiptRequired !== false) return false;
      if (receiptFilter === "unset" && expenseType.receiptRequired !== null) return false;
      return true;
    });
  }, [editor.expenseTypes, keyword, policyFilter, statusFilter, receiptFilter]);

  if (editor.policies.length === 0) {
    return (
      <div className="settingsPanel">
        <h2>経費タイプ</h2>
        <p className="flowEmptyOptionsHint">
          先にポリシーを1件以上作成してください。経費タイプは必ずいずれかのポリシーに属します。
        </p>
      </div>
    );
  }

  const isEmpty = editor.expenseTypes.length === 0;

  return (
    <div className="settingsPanel">
      <h2>経費タイプ</h2>

      {isEmpty && !isAdding && <p className="flowEmptyOptionsHint">経費タイプがまだありません。</p>}

      {!isEmpty && (
        <div className="settingsFilterBar">
          <input
            type="search"
            className="settingsSearchInput"
            placeholder="経費タイプ名で検索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <span className="settingsSelectWrap">
            <select
              className="settingsSelectInput"
              value={policyFilter}
              onChange={(event) => setPolicyFilter(event.target.value)}
            >
              <option value="">すべてのポリシー</option>
              {editor.policies.map((policy) => (
                <option key={policy.policy_id} value={policy.policy_id}>
                  {policy.policy_name}
                </option>
              ))}
            </select>
          </span>
          <span className="settingsSelectWrap">
            <select
              className="settingsSelectInput"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">すべての状態</option>
              <option value="active">使用中のみ</option>
              <option value="inactive">使用停止のみ</option>
            </select>
          </span>
          <span className="settingsSelectWrap">
            <select
              className="settingsSelectInput"
              value={receiptFilter}
              onChange={(event) => setReceiptFilter(event.target.value)}
            >
              <option value="">領収書要否すべて</option>
              <option value="required">必要</option>
              <option value="not_required">不要</option>
              <option value="unset">未設定</option>
            </select>
          </span>
        </div>
      )}

      {!isEmpty && (
        <div className="settingsTableWrap">
          <table className="settingsTable">
            <thead>
              <tr>
                <th>経費タイプ</th>
                <th>ポリシー</th>
                <th>領収書</th>
                <th>状態</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((expenseType) => (
                <ExpenseTypeRow
                  key={expenseType.id}
                  expenseType={expenseType}
                  editor={editor}
                  policies={editor.policies}
                />
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="flowEmptyOptionsHint">条件に一致する経費タイプがありません。</p>
          )}
        </div>
      )}

      {isAdding ? (
        <AddExpenseTypeForm editor={editor} policies={editor.policies} onDone={() => setIsAdding(false)} />
      ) : (
        <button type="button" className="flowAddOptionButton" onClick={() => setIsAdding(true)}>
          {isEmpty ? "＋ 最初の経費タイプを追加" : "＋ 経費タイプを追加"}
        </button>
      )}
    </div>
  );
}
