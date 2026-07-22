// 未保存の変更がある状態で会社を切り替えよう（または新しい会社の作成を
// 始めよう）とした時に割り込む確認ダイアログ。ConfirmDialog（削除確認用）とは
// 選択肢が3つ（保存して移動／保存せず移動／キャンセル）ある点で異なるため、
// 既存のConfirmDialogは変更せず、専用の小さいコンポーネントとして分離した。
export default function UnsavedChangesDialog({
  isSaving,
  errorMessage,
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
}) {
  return (
    <div className="confirmOverlay" role="presentation" onClick={onCancel}>
      <div
        className="confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="unsaved-changes-dialog-title">保存されていない変更があります</h3>
        <p className="confirmMessage">
          保存されていない変更があります。移動すると変更内容が失われます。
        </p>

        {errorMessage && <p className="settingsErrorText">{errorMessage}</p>}

        <div className="confirmActions unsavedChangesActions">
          <button
            type="button"
            className="confirmCancelButton"
            onClick={onCancel}
            disabled={isSaving}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="flowGhostButton"
            onClick={onDiscardAndContinue}
            disabled={isSaving}
          >
            保存せず移動
          </button>
          <button
            type="button"
            className="importConfirmButton"
            onClick={onSaveAndContinue}
            disabled={isSaving}
          >
            {isSaving ? "保存中…" : "保存して移動"}
          </button>
        </div>
      </div>
    </div>
  );
}
