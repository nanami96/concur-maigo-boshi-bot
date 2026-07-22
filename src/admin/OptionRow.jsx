import { useState } from "react";
import EditableText from "./EditableText";
import ResultForm from "./ResultForm";
import QuestionCard from "./QuestionCard";
import OptionMenu from "./OptionMenu";
import { useFlowEditorContext } from "./FlowEditorContext";

// 「この選択肢の後」の切替。詳細編集を開いた時だけ表示するため、
// 全選択肢に常時大きなボタンが並ぶ状態を避け、コンパクトなラジオ表示にしている。
function NextTypeSwitch({ optionId, nextType }) {
  const { editor, requestConfirm } = useFlowEditorContext();

  const switchTo = (targetType) => {
    if (nextType === targetType) {
      return;
    }

    const impact = editor.computeBranchImpact(optionId);
    const hasImpact = impact.questionCount + impact.optionCount + impact.resultCount > 0;
    const run = () =>
      targetType === "question"
        ? editor.setOptionNextToNewQuestion(optionId, "")
        : editor.setOptionNextToResult(optionId);

    if (hasImpact) {
      requestConfirm({
        title:
          targetType === "question"
            ? "次の質問へ切り替えますか？"
            : "結果を表示するへ切り替えますか？",
        message:
          targetType === "question"
            ? "この選択肢に設定済みの結果は失われます。"
            : "この選択肢の先につながっている質問・選択肢・結果は失われます。",
        impact,
        confirmLabel: "切り替える",
        onConfirm: run,
      });
      return;
    }

    run();
  };

  return (
    <div className="nextTypeSwitch" role="radiogroup" aria-label="この選択肢を選んだ後の動き">
      <label className={nextType === "question" ? "nextTypeOption selected" : "nextTypeOption"}>
        <input
          type="radio"
          name={`next-type-${optionId}`}
          checked={nextType === "question"}
          onChange={() => switchTo("question")}
        />
        次の質問へ進む
      </label>
      <label className={nextType === "result" ? "nextTypeOption selected" : "nextTypeOption"}>
        <input
          type="radio"
          name={`next-type-${optionId}`}
          checked={nextType === "result"}
          onChange={() => switchTo("result")}
        />
        結果を表示する
      </label>
    </div>
  );
}

// 通常表示用の1行要約。「この選択肢の先に何があるか」だけを伝える。
// next.type === "question" の場合は、直下に表示される質問カード自体が要約を兼ねるため
// （「→ 次の質問」ラベル＋質問カード）、ここでは何も描画しない＝同じ内容の二重表示を避ける。
function NextSummary({ next, expenseTypes }) {
  if (next.type === "result") {
    const candidates = next.candidates || [];

    if (candidates.length === 0 || !candidates[0].expenseTypeId) {
      return <span className="flowNextSummary warning">⚠ 結果が未設定です</span>;
    }

    const firstExpenseType = expenseTypes.find(
      (item) => item.id === candidates[0].expenseTypeId,
    );
    const extra = candidates.length > 1 ? ` ほか${candidates.length - 1}件` : "";

    return (
      <span className="flowNextSummary">
        <span className="flowNextArrow">→</span>
        <span className="flowResultBadge">結果</span>
        <strong>{firstExpenseType?.name || "（存在しない経費タイプ）"}</strong>
        {extra}
      </span>
    );
  }

  if (next.type === "unset") {
    return <span className="flowNextSummary warning">⚠ 次の質問か結果が未設定です</span>;
  }

  return null;
}

export default function OptionRow({ questionId, optionId, index, optionCount }) {
  const { editor, issuesByOption, requestConfirm, expenseTypes } = useFlowEditorContext();
  const option = editor.flow.options[optionId];
  const issues = issuesByOption[optionId] || [];
  const [isEditing, setIsEditing] = useState(false);

  // 本来はCompanyEditor側のnormalizeFlowで、optionIdは必ずeditor.flow.optionsに
  // 実在するキーになっているはずだが、それでもなお解決できない場合に備えた
  // 最後の防波堤。ここで黙って握りつぶす・データを捏造することはせず、
  // 「設定データが壊れている」ことが利用者に分かる形で表示し、React全体の
  // クラッシュ（Error Boundary発火）を防ぐだけにとどめる。
  if (!option) {
    return (
      <li className="flowOptionRow flowOptionRowError" id={`fo-${optionId}`}>
        <p className="flowIssue error">
          ⚠ この選択肢のデータが見つかりません（設定データが壊れている可能性があります）。
        </p>
      </li>
    );
  }

  const next = option.next || { type: "unset" };
  const hasError = issues.some((issue) => issue.level === "error");

  const handleDelete = () => {
    const impact = editor.computeBranchImpact(optionId);
    const hasImpact = impact.questionCount + impact.optionCount + impact.resultCount > 0;
    const run = () => editor.deleteOption(questionId, optionId);

    if (hasImpact) {
      requestConfirm({
        title: "選択肢を削除しますか？",
        message: `「${option.label || "(文言未入力)"}」を削除します。`,
        impact,
        confirmLabel: "削除する",
        onConfirm: run,
      });
      return;
    }

    run();
  };

  const menuItems = [
    { label: isEditing ? "編集を閉じる" : "編集", onClick: () => setIsEditing((value) => !value) },
    {
      label: "上へ移動",
      disabled: index === 0,
      onClick: () => editor.reorderOption(questionId, index, index - 1),
    },
    {
      label: "下へ移動",
      disabled: index === optionCount - 1,
      onClick: () => editor.reorderOption(questionId, index, index + 1),
    },
    { label: "削除", danger: true, onClick: handleDelete },
  ];

  return (
    <li className="flowOptionRow" id={`fo-${optionId}`}>
      <div className="flowOptionSummary">
        <button
          type="button"
          className={hasError ? "flowOptionLabelButton hasError" : "flowOptionLabelButton"}
          onClick={() => setIsEditing((value) => !value)}
        >
          {option.label || "（文言未入力）"}
        </button>

        <OptionMenu items={menuItems} />
      </div>

      {(next.type === "result" || next.type === "unset") && (
        <p className="flowNextSummaryLine">
          <NextSummary next={next} expenseTypes={expenseTypes} />
        </p>
      )}

      {issues.length > 0 && (
        <ul className="flowIssueList">
          {issues.map((issue) => (
            <li key={issue.id} className={`flowIssue ${issue.level}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {isEditing && (
        <div className="flowOptionDetail">
          <label className="flowFieldLabel">
            選択肢の表示名
            <EditableText
              className="flowOptionLabelInput"
              value={option.label}
              placeholder="ボタンに表示する文言（例：タクシー）"
              ariaLabel="選択肢の文言"
              onCommit={(text) => editor.updateOptionLabel(optionId, text)}
            />
          </label>

          <div className="flowFieldLabel">
            この選択肢の後
            <NextTypeSwitch optionId={optionId} nextType={next.type} />
          </div>

          {next.type === "result" && (
            <ResultForm optionId={optionId} candidates={next.candidates || []} />
          )}

          <button
            type="button"
            className="flowGhostButton flowCloseDetailButton"
            onClick={() => setIsEditing(false)}
          >
            閉じる
          </button>
        </div>
      )}

      {next.type === "question" && (
        <div className="flowChildQuestion">
          <p className="flowNextQuestionLabel">
            <span className="flowNextArrow">→</span> 次の質問
          </p>
          <QuestionCard questionId={next.questionId} />
        </div>
      )}
    </li>
  );
}
