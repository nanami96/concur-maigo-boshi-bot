import { useState } from "react";
import PublishConfirmDialog from "./PublishConfirmDialog";

function formatTimestamp(iso) {
  if (!iso) {
    return null;
  }
  try {
    return new Date(iso).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return null;
  }
}

// 「下書きを保存」（DraftSaveBar）とは意味が違うことが一目で分かるよう、
// 見た目・文言・色を変えている。
//   下書き保存 … 編集途中の内容をブラウザを閉じても消えないようにするだけ
//   公開する   … 利用者向けの正式版（published_versions）を新たに作る
export default function PublishPanel({ publish }) {
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    errors,
    warnings,
    canPublish,
    publishStatus,
    errorMessage,
    lastPublishedAt,
    history,
    currentPublishedVersionId,
    publish: triggerPublish,
  } = publish;

  async function handleConfirmPublish() {
    const result = await triggerPublish();
    if (result.success) {
      setShowConfirm(false);
    }
    // 失敗時はダイアログを開いたままにし、errorMessageを表示して再試行できるようにする。
  }

  return (
    <div className="publishPanel">
      <div className="publishStatusRow">
        <span className="publishStatusText">
          {lastPublishedAt
            ? `公開済み（最終公開：${formatTimestamp(lastPublishedAt)}）`
            : "まだ公開されていません"}
        </span>
        <button
          type="button"
          className="publishButton"
          onClick={() => setShowConfirm(true)}
          disabled={!canPublish || publishStatus === "publishing"}
          title={errors.length > 0 ? `Errorが${errors.length}件あるため公開できません` : undefined}
        >
          公開する
        </button>
      </div>

      {errors.length > 0 && (
        <p className="publishBlockedNotice">
          Errorが{errors.length}件あるため公開できません。設定チェック画面で確認してください。
        </p>
      )}

      {history.length > 0 && (
        <details className="publishHistory">
          <summary>公開履歴（{history.length}件）</summary>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                {formatTimestamp(item.published_at)}
                {item.id === currentPublishedVersionId ? "　現在公開中" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {showConfirm && (
        <PublishConfirmDialog
          warnings={warnings}
          isPublishing={publishStatus === "publishing"}
          errorMessage={publishStatus === "error" ? errorMessage : null}
          onConfirm={handleConfirmPublish}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
