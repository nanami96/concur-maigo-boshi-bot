import { useState } from "react";
import EditableText from "./EditableText";
import OptionRow from "./OptionRow";
import { useFlowEditorContext } from "./FlowEditorContext";

// 通常表示は「質問文のテキスト＋ここから試す＋編集」だけの1行にとどめ、
// 質問文を常時入力フォームにしない（クリック／編集ボタンでのみ入力に切り替える）。
export default function QuestionCard({ questionId }) {
  const {
    editor,
    issuesByQuestion,
    onStartPreviewFrom,
    collapsedQuestionIds,
    toggleQuestionCollapsed,
  } = useFlowEditorContext();
  const question = editor.flow.questions[questionId];
  const [isEditingText, setIsEditingText] = useState(false);

  if (!question) {
    return null;
  }

  const issues = issuesByQuestion[questionId] || [];
  const hasError = issues.some((issue) => issue.level === "error");
  const isCollapsed = collapsedQuestionIds.has(questionId);

  return (
    <div className="flowQuestionCard" id={`fq-${questionId}`}>
      <div className="flowQuestionMetaRow">
        <button
          type="button"
          className="flowCaretButton"
          aria-label={isCollapsed ? "この先の選択肢を展開する" : "この先の選択肢を折りたたむ"}
          aria-expanded={!isCollapsed}
          onClick={() => toggleQuestionCollapsed(questionId)}
        >
          {isCollapsed ? "▶" : "▼"}
        </button>

        <span className="flowKicker">質問</span>

        <div className="flowQuestionActions">
          {onStartPreviewFrom && (
            <button
              type="button"
              className="flowGhostButton"
              onClick={() => onStartPreviewFrom(questionId)}
            >
              ここから試す
            </button>
          )}
          <button
            type="button"
            className="flowGhostButton"
            onClick={() => setIsEditingText((value) => !value)}
          >
            {isEditingText ? "完了" : "編集"}
          </button>
        </div>
      </div>

      <div className="flowQuestionTextRow">
        {isEditingText ? (
          <EditableText
            className="flowQuestionTextInput"
            value={question.text}
            placeholder="質問文を入力してください（例：何の経費ですか？）"
            ariaLabel="質問文"
            onCommit={(text) => editor.updateQuestionText(questionId, text)}
          />
        ) : (
          <button
            type="button"
            className={hasError ? "flowQuestionTextButton hasError" : "flowQuestionTextButton"}
            onClick={() => setIsEditingText(true)}
          >
            {question.text || "（質問文が未入力です）"}
          </button>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="flowIssueList">
          {issues.map((issue) => (
            <li key={issue.id} className={`flowIssue ${issue.level}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {!isCollapsed && (
        <>
          {question.optionIds.length > 0 && <p className="flowOptionsHeading">選択肢</p>}

          <ul className="flowOptionList">
            {question.optionIds.map((optionId, index) => (
              <OptionRow
                key={optionId}
                questionId={questionId}
                optionId={optionId}
                index={index}
                optionCount={question.optionIds.length}
              />
            ))}
          </ul>

          {question.optionIds.length === 0 && (
            <p className="flowEmptyOptionsHint">まだ選択肢がありません。</p>
          )}

          <button
            type="button"
            className="flowAddOptionButton"
            onClick={() => editor.addOption(questionId, "")}
          >
            ＋ 選択肢を追加
          </button>
        </>
      )}

      {isCollapsed && question.optionIds.length > 0 && (
        <p className="flowCollapsedHint">選択肢{question.optionIds.length}件を折りたたみ中</p>
      )}
    </div>
  );
}
