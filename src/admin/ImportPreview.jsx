import FlowTreeReadOnlyView from "./FlowTreeReadOnlyView";

function IssueGroup({ title, items }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={`checkGroup ${items[0].level}`}>
      <h3>{title}</h3>
      <ul className="checkList">
        {items.map((issue) => (
          <li key={issue.id}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

// Excelインポートのプレビュー画面。パース結果（未確定）を表示するだけで、
// 確定ボタン（既定は「この内容で初期設定を作成」）が押されるまで何もコミットしない。
//
// confirmLabel・noticeTextは、既存会社の通常管理画面からのインポート
// （ExcelImportSection.jsx）でボタン文言・案内文を「下書きに反映する」という
// 文脈に合わせて差し替えられるようにするための任意プロパティ。指定が無ければ
// 従来通り初期セットアップ向けの文言のまま動作する（InitialSetupScreen経由の
// 既存フローには一切影響しない）。
//
// companyIdWarningも同様に任意で、既存会社への取り込み時に「Excel内の会社IDが
// 現在の会社と異なる」場合の注意文をこの画面内に表示するためのもの
// （ExcelImportSection.jsx参照。会社IDそのものは常に現在の会社のものが使われ、
// Excelの値で置き換わることはない）。
export default function ImportPreview({
  parseResult,
  onConfirm,
  onReselect,
  confirmLabel = "この内容で初期設定を作成",
  noticeText = "まだ何も確定していません。内容を確認してから「この内容で初期設定を作成」を押してください。",
  companyIdWarning = null,
}) {
  const { company, policies, expenseTypes, flow, errors, warnings } = parseResult;

  const questionCount = flow ? Object.keys(flow.questions).length : 0;
  const optionValues = flow ? Object.values(flow.options) : [];
  const optionCount = optionValues.length;
  const resultCount = optionValues.filter((option) => option.next?.type === "result").length;

  const canConfirm = errors.length === 0 && !!flow;

  return (
    <div className="importPreview">
      <h2>インポートプレビュー</h2>
      <p className="importPreviewNotice">{noticeText}</p>

      {companyIdWarning && (
        <p className="settingsErrorText" role="alert">
          {companyIdWarning}
        </p>
      )}

      <div className="importSummaryGrid">
        <div className="importSummaryItem">
          <span>会社名</span>
          <strong>{company?.company_name || "（未設定）"}</strong>
        </div>
        <div className="importSummaryItem">
          <span>ポリシー</span>
          <strong>{policies.length}件</strong>
        </div>
        <div className="importSummaryItem">
          <span>経費タイプ</span>
          <strong>{expenseTypes.length}件</strong>
        </div>
        <div className="importSummaryItem">
          <span>質問</span>
          <strong>{questionCount}件</strong>
        </div>
        <div className="importSummaryItem">
          <span>選択肢</span>
          <strong>{optionCount}件</strong>
        </div>
        <div className="importSummaryItem">
          <span>最終結果</span>
          <strong>{resultCount}件</strong>
        </div>
      </div>

      <div className="checkSummaryGrid">
        <div className="checkMetric error">
          <span>Error</span>
          <strong>{errors.length}</strong>
        </div>
        <div className="checkMetric warning">
          <span>Warning</span>
          <strong>{warnings.length}</strong>
        </div>
      </div>

      {errors.length > 0 && (
        <p className="checkBlockNotice">
          Errorが解消されるまで、この内容では初期設定を作成できません。Excelを修正して選び直してください。
        </p>
      )}

      <IssueGroup title="Error" items={errors} />
      <IssueGroup title="Warning" items={warnings} />

      {flow && (
        <details className="overviewSection" open>
          <summary>質問フローのツリー</summary>
          <FlowTreeReadOnlyView flow={flow} baseData={{ company, policies, expenseTypes }} />
        </details>
      )}

      {expenseTypes.length > 0 && (
        <details className="overviewSection">
          <summary>経費タイプ一覧（{expenseTypes.length}件）</summary>
          <ul className="importExpenseTypeList">
            {expenseTypes.map((expenseType) => (
              <li key={expenseType.id}>
                {expenseType.name}
                {!expenseType.active && <span className="importInactiveBadge">使用有無N</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="importPreviewActions">
        <button type="button" className="flowGhostButton" onClick={onReselect}>
          別のファイルを選び直す
        </button>
        <button type="button" className="importConfirmButton" disabled={!canConfirm} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
