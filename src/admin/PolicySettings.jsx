import { useState } from "react";
import OptionMenu from "./OptionMenu";
import ConfirmDialog from "./ConfirmDialog";
import EditableText from "./EditableText";

function PolicyRow({ policy, editor }) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const usageCount = editor.computePolicyUsage(policy.policy_id);

  const handleDelete = () => {
    if (usageCount > 0) {
      setConfirmRequest({
        title: "このポリシーは使用中です",
        message: `このポリシーは${usageCount}件の経費タイプで使用されています。削除すると経費タイプ側の参照が壊れるため、まずは使用停止にすることをおすすめします。`,
        confirmLabel: "使用停止にする",
        onConfirm: () => editor.updatePolicy(policy.policy_id, { enabled: "N" }),
      });
      return;
    }

    setConfirmRequest({
      title: "ポリシーを削除しますか？",
      message: `「${policy.policy_name || policy.policy_id}」を削除します。`,
      confirmLabel: "削除する",
      onConfirm: () => editor.deletePolicy(policy.policy_id),
    });
  };

  const menuItems = [
    { label: isEditing ? "編集を閉じる" : "編集", onClick: () => setIsEditing((value) => !value) },
    { label: "削除", danger: true, onClick: handleDelete },
  ];

  return (
    <div className="settingsCard">
      <div className="settingsCardSummary">
        <div className="settingsCardTitleRow">
          <strong>{policy.policy_name || "（名称未設定）"}</strong>
          <span className={policy.enabled === "Y" ? "settingsStatusBadge active" : "settingsStatusBadge inactive"}>
            {policy.enabled === "Y" ? "使用中" : "使用停止"}
          </span>
        </div>
        <p className="settingsCardMeta">経費タイプ：{usageCount}件</p>
        <OptionMenu items={menuItems} />
      </div>

      {isEditing && (
        <div className="settingsCardDetail">
          <label className="flowFieldLabel">
            ポリシー名
            <EditableText
              className="settingsTextInput"
              value={policy.policy_name}
              ariaLabel="ポリシー名"
              onCommit={(name) => editor.updatePolicy(policy.policy_id, { policy_name: name })}
            />
          </label>

          <label className="flowFieldLabel">
            使用有無
            <span className="settingsSelectWrap">
              <select
                className="settingsSelectInput"
                value={policy.enabled}
                onChange={(event) => editor.updatePolicy(policy.policy_id, { enabled: event.target.value })}
              >
                <option value="Y">使用する</option>
                <option value="N">使用しない</option>
              </select>
            </span>
          </label>

          <p className="settingsHint">
            ポリシーID（Concur側の識別子）: <code>{policy.policy_id}</code>（作成後は変更できません）
          </p>

          <button type="button" className="flowGhostButton" onClick={() => setIsEditing(false)}>
            閉じる
          </button>
        </div>
      )}

      <ConfirmDialog
        request={confirmRequest}
        onConfirm={() => {
          confirmRequest?.onConfirm();
          setConfirmRequest(null);
        }}
        onCancel={() => setConfirmRequest(null)}
      />
    </div>
  );
}

function AddPolicyForm({ editor, onDone }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState("Y");
  const [error, setError] = useState(null);

  const handleSubmit = () => {
    const trimmedId = id.trim();
    const trimmedName = name.trim();

    if (!trimmedId) {
      setError("ポリシーID（Concur側の識別子）を入力してください。");
      return;
    }
    if (!trimmedName) {
      setError("ポリシー名を入力してください。");
      return;
    }
    if (editor.policies.some((policy) => policy.policy_id === trimmedId)) {
      setError(`ポリシーID「${trimmedId}」は既に使われています。`);
      return;
    }

    editor.addPolicy({ policy_id: trimmedId, policy_name: trimmedName, enabled });
    onDone();
  };

  return (
    <div className="settingsCard settingsAddForm">
      <label className="flowFieldLabel">
        ポリシーID（Concur側の識別子）
        <input
          className="settingsTextInput"
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="例：normal_expense"
        />
      </label>

      <label className="flowFieldLabel">
        ポリシー名
        <input
          className="settingsTextInput"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例：通常経費"
        />
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

export default function PolicySettings({ editor }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEmpty = editor.policies.length === 0;

  return (
    <div className="settingsPanel">
      <h2>ポリシー</h2>

      {isEmpty && !isAdding && <p className="flowEmptyOptionsHint">ポリシーがまだありません。</p>}

      <div className="settingsCardList">
        {editor.policies.map((policy) => (
          <PolicyRow key={policy.policy_id} policy={policy} editor={editor} />
        ))}
      </div>

      {isAdding ? (
        <AddPolicyForm editor={editor} onDone={() => setIsAdding(false)} />
      ) : (
        <button type="button" className="flowAddOptionButton" onClick={() => setIsAdding(true)}>
          {isEmpty ? "＋ 最初のポリシーを追加" : "＋ ポリシーを追加"}
        </button>
      )}
    </div>
  );
}
