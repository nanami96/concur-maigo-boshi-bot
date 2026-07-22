import { useMemo, useState } from "react";
import { checkFlow } from "../flow/flowChecks";
import { FlowEditorProvider } from "./FlowEditorContext";
import ConfirmDialog from "./ConfirmDialog";
import QuestionCard from "./QuestionCard";

function groupIssuesByTarget(issues) {
  const byQuestion = {};
  const byOption = {};

  issues.forEach((issue) => {
    if (issue.optionId) {
      (byOption[issue.optionId] ||= []).push(issue);
    } else if (issue.questionId) {
      (byQuestion[issue.questionId] ||= []).push(issue);
    }
  });

  return { byQuestion, byOption };
}

function FirstQuestionPrompt({ editor }) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flowEmptyState">
      <p>まだ質問が1つも設定されていません。最初の質問を作成してください。</p>
      <input
        type="text"
        className="flowQuestionTextInput"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="例：何の経費ですか？"
        aria-label="最初の質問文"
      />
      <button
        type="button"
        className="flowCreateFirstQuestionButton"
        onClick={() => editor.addRootQuestion(draft || "")}
      >
        最初の質問を作成
      </button>
    </div>
  );
}

export default function FlowOutlineEditor({ editor, expenseTypes, onStartPreviewFrom }) {
  const [confirmRequest, setConfirmRequest] = useState(null);
  // 質問単位の折りたたみ状態。flowデータそのものではなく、あくまで画面表示だけのstate。
  const [collapsedQuestionIds, setCollapsedQuestionIds] = useState(() => new Set());

  const { byQuestion, byOption } = useMemo(() => {
    const { errors, warnings } = checkFlow(editor.flow, expenseTypes);
    return groupIssuesByTarget([...errors, ...warnings]);
  }, [editor.flow, expenseTypes]);

  const requestConfirm = (request) => setConfirmRequest(request);
  const handleCancel = () => setConfirmRequest(null);
  const handleConfirm = () => {
    confirmRequest?.onConfirm();
    setConfirmRequest(null);
  };

  const toggleQuestionCollapsed = (questionId) => {
    setCollapsedQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedQuestionIds(new Set());
  const collapseAll = () =>
    setCollapsedQuestionIds(new Set(Object.keys(editor.flow.questions)));

  const contextValue = {
    editor,
    expenseTypes,
    issuesByQuestion: byQuestion,
    issuesByOption: byOption,
    requestConfirm,
    onStartPreviewFrom,
    collapsedQuestionIds,
    toggleQuestionCollapsed,
  };

  return (
    <FlowEditorProvider value={contextValue}>
      <div className="flowOutlineEditor">
        {editor.undoMessage && (
          <div className="undoToast">
            <span>{editor.undoMessage}</span>
            <button type="button" onClick={editor.undo}>
              元に戻す
            </button>
            <button
              type="button"
              className="undoToastDismiss"
              aria-label="通知を閉じる"
              onClick={editor.dismissUndoMessage}
            >
              ×
            </button>
          </div>
        )}

        {editor.flow.rootQuestionId ? (
          <>
            <div className="flowOutlineToolbar">
              <button type="button" className="flowGhostButton" onClick={expandAll}>
                すべて展開
              </button>
              <button type="button" className="flowGhostButton" onClick={collapseAll}>
                すべて折りたたむ
              </button>
            </div>
            <QuestionCard questionId={editor.flow.rootQuestionId} />
          </>
        ) : (
          <FirstQuestionPrompt editor={editor} />
        )}
      </div>

      <ConfirmDialog
        request={confirmRequest}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </FlowEditorProvider>
  );
}
