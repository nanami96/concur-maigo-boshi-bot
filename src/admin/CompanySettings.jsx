import EditableText from "./EditableText";

// 会社名だけを編集できるシンプルなフォーム。会社ID（内部識別子・将来のテナントキー）は
// 「詳細情報」に折りたたんで表示するだけで、通常操作では編集させない。
export default function CompanySettings({ editor, onGoToPolicies }) {
  const { company } = editor;
  const hasNoPolicies = editor.policies.length === 0;

  return (
    <div className="settingsPanel">
      <h2>基本設定</h2>

      <label className="flowFieldLabel settingsCompanyNameField">
        会社名
        <EditableText
          className="settingsTextInput"
          value={company.company_name}
          placeholder="例：サンプル会社"
          ariaLabel="会社名"
          onCommit={(name) => editor.updateCompanyName(name)}
        />
      </label>

      <details className="settingsAdvancedDetails">
        <summary>詳細情報</summary>
        <p className="settingsHint">
          会社ID（内部識別子）: <code>{company.company_id || "（未設定）"}</code>
        </p>
        <p className="settingsHint">
          会社IDは内部の識別子として使われるため、作成後は変更できません。
        </p>
      </details>

      {hasNoPolicies && (
        <p className="settingsNextStepHint">
          次はポリシーを作成しましょう。
          {onGoToPolicies && (
            <button type="button" className="flowGhostButton" onClick={onGoToPolicies}>
              ポリシーへ進む →
            </button>
          )}
        </p>
      )}
    </div>
  );
}
