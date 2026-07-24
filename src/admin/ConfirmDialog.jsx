// 削除・分岐切替など、配下のデータが失われる操作の前に必ず経由する確認モーダル。
export default function ConfirmDialog({ request, onConfirm, onCancel }) {
  if (!request) {
    return null;
  }

  return (
    <div className="confirmOverlay" role="presentation" onClick={onCancel}>
      <div
        className="confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="confirm-dialog-title">{request.title || "確認してください"}</h3>
        <p className="confirmMessage">{request.message}</p>
        {request.note && <p className="confirmNote">{request.note}</p>}
        {request.impact && (
          <p className="confirmImpact">
            質問{request.impact.questionCount}件・選択肢{request.impact.optionCount}件・結果
            {request.impact.resultCount}件が削除されます。
          </p>
        )}
        <div className="confirmActions">
          <button type="button" className="confirmCancelButton" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="confirmOkButton"
            onClick={() => {
              onConfirm();
            }}
          >
            {request.confirmLabel || "実行する"}
          </button>
        </div>
      </div>
    </div>
  );
}
