// 「公開する」ボタンを押した後の確認モーダル。Errorが1件でもある場合は
// PublishPanel側でボタン自体を無効化しているため、このダイアログが開くのは
// 常に「Error 0件（Warningは0件以上）」の状態のみ。
export default function PublishConfirmDialog({ warnings, isPublishing, errorMessage, onConfirm, onCancel }) {
  return (
    <div className="confirmOverlay" role="presentation" onClick={onCancel}>
      <div
        className="confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="publish-confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="publish-confirm-dialog-title">現在の設定を公開しますか？</h3>
        <p className="confirmMessage">
          新しい公開バージョンが作成されます。現在の下書きはそのまま残り、過去の公開版も削除されません。
        </p>

        {warnings.length > 0 && (
          <div className="publishWarningSummary">
            <p>
              警告が{warnings.length}件あります。このまま公開しますか？
            </p>
            <ul>
              {warnings.slice(0, 5).map((warning) => (
                <li key={warning.id}>{warning.message}</li>
              ))}
              {warnings.length > 5 && <li>ほか{warnings.length - 5}件</li>}
            </ul>
          </div>
        )}

        {errorMessage && <p className="settingsErrorText">{errorMessage}</p>}

        <div className="confirmActions">
          <button
            type="button"
            className="confirmCancelButton"
            onClick={onCancel}
            disabled={isPublishing}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="importConfirmButton"
            onClick={onConfirm}
            disabled={isPublishing}
          >
            {isPublishing ? "公開中…" : "公開する"}
          </button>
        </div>
      </div>
    </div>
  );
}
