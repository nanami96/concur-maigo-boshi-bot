import { useEffect, useState } from "react";

// 削除・分岐切替など、配下のデータが失われる操作の前に必ず経由する確認モーダル。
//
// request.confirmInput（任意）：会社削除等、特に取り返しのつかない操作向けの
// 誤操作防止。{label, expectedValue}を渡すと、入力欄が表示され、入力値が
// expectedValueと完全一致するまで確定ボタンをdisabledにする。指定しない
// 既存の呼び出し元（UserManagementPanelの「会社から削除」等）の見た目・
// 挙動は一切変わらない。
export default function ConfirmDialog({ request, onConfirm, onCancel }) {
  const [confirmInputValue, setConfirmInputValue] = useState("");

  // requestが変わる（新しい確認ダイアログが開く／閉じる）たびに入力値をリセットする。
  // 前回別の対象を確認した際の入力が次の確認に持ち越されないようにするため。
  useEffect(() => {
    setConfirmInputValue("");
  }, [request]);

  if (!request) {
    return null;
  }

  const confirmInput = request.confirmInput;
  const isConfirmDisabled = Boolean(confirmInput) && confirmInputValue !== confirmInput.expectedValue;

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
        {confirmInput && (
          <label className="confirmInputLabel">
            {confirmInput.label}
            <input
              type="text"
              className="settingsTextInput"
              value={confirmInputValue}
              onChange={(event) => setConfirmInputValue(event.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
          </label>
        )}
        <div className="confirmActions">
          <button type="button" className="confirmCancelButton" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="confirmOkButton"
            disabled={isConfirmDisabled}
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
