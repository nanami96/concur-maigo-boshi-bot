import { useMemo } from "react";
import { runConfigChecks } from "../flow/runConfigChecks";

function IssueList({ title, items, onJump }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={`checkGroup ${items[0].level}`}>
      <h3>{title}</h3>
      <ul className="checkList">
        {items.map((issue) => (
          <li key={issue.id}>
            <button type="button" className="checkJumpButton" onClick={() => onJump(issue)}>
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Error/Warning件数のサマリと一覧を出す。IDではなく自然文のメッセージのみを表示する。
// 質問フロー（flowChecks）と基本設定・ポリシー・経費タイプ（masterDataChecks）の
// チェック結果をこの画面でまとめて表示する。
export default function ConfigCheckPanel({ company, policies, expenseTypes, flow, onJumpToNode, onJumpToSettings }) {
  const { errors, warnings } = useMemo(
    () => runConfigChecks({ company, policies, expenseTypes, flow }),
    [company, policies, expenseTypes, flow],
  );

  const handleJump = (issue) => {
    if (issue.target && onJumpToSettings) {
      onJumpToSettings(issue.target);
      return;
    }
    onJumpToNode?.({ questionId: issue.questionId, optionId: issue.optionId });
  };

  return (
    <div className="configCheckPanel">
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

      {errors.length === 0 && warnings.length === 0 && (
        <p className="checkOk">設定チェックOK。プレビューで動作を確認してください。</p>
      )}

      {errors.length > 0 && (
        <p className="checkBlockNotice">
          Errorが解消されるまで、この設定は正しく公開できません。
        </p>
      )}

      <IssueList title="Error" items={errors} onJump={handleJump} />
      <IssueList title="Warning" items={warnings} onJump={handleJump} />
    </div>
  );
}
