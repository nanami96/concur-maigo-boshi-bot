import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

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

// どの設定タブにいても見える、下書き保存の状態表示＋明示保存ボタン＋
// 「保存前の状態に戻す」ボタン。
// 「保存されたと思っていたのに消えていた」を防ぐため、保存済みと
// 主張してよいのは実際にlastSavedAtがある時だけにしている。
//
// onRevert: 「保存前の状態に戻す」確定時に呼ぶ非同期関数。
//   Supabase上の最新下書きを再取得してeditorへ反映する処理はAdminWorkspace側が
//   持っており、このコンポーネントはボタン・確認ダイアログ・結果表示だけを担当する。
export default function DraftSaveBar({ persistence, onRevert, revertStatus, revertErrorMessage }) {
  const { canSave, persistenceReason, isDirty, saveStatus, lastSavedAt, errorMessage, saveNow } =
    persistence;
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!canSave) {
    const message =
      persistenceReason === "local"
        ? "ローカル開発モードで動作しています。変更は保存されません。"
        : persistenceReason === "checking"
          ? "保存先を確認しています…"
          : "この会社はまだ保存先（Supabase）に登録されていません。編集内容はこのブラウザ内でのみ保持されます。";

    return (
      <div className="draftSaveBar draftSaveBarDisabled" role="status">
        <span>{message}</span>
      </div>
    );
  }

  let statusText;
  let statusClass = "draftSaveStatus";

  if (saveStatus === "saving") {
    statusText = "保存中…";
    statusClass += " draftSaveStatusSaving";
  } else if (saveStatus === "error") {
    statusText = errorMessage;
    statusClass += " draftSaveStatusError";
  } else if (isDirty) {
    statusText = "未保存の変更があります";
    statusClass += " draftSaveStatusDirty";
  } else if (lastSavedAt) {
    statusText = `● 保存済み（最終保存：${formatTimestamp(lastSavedAt)}）`;
    statusClass += " draftSaveStatusClean";
  } else {
    statusText = "まだ下書きは保存されていません";
  }

  async function handleConfirmRevert() {
    const result = await onRevert?.();
    if (result?.success) {
      setConfirmOpen(false);
    }
    // 失敗時はダイアログを開いたままにし、revertErrorMessageを表示する
    // （現在の未保存編集はAdminWorkspace側で一切変更されない）。
  }

  return (
    <div className="draftSaveBar" role="status">
      <span className={statusClass}>{statusText}</span>
      <div className="draftSaveBarActions">
        <button
          type="button"
          className="draftRevertButton"
          onClick={() => setConfirmOpen(true)}
          disabled={!isDirty || revertStatus === "loading"}
        >
          保存前の状態に戻す
        </button>
        <button
          type="button"
          className="draftSaveButton"
          onClick={saveNow}
          disabled={saveStatus === "saving"}
        >
          下書きを保存
        </button>
      </div>

      {revertStatus === "error" && <p className="settingsErrorText">{revertErrorMessage}</p>}

      <ConfirmDialog
        request={
          confirmOpen
            ? {
                title: "保存前の状態に戻しますか？",
                message:
                  "保存されていない変更を破棄して、最後に保存した下書きの状態へ戻します。この操作は元に戻せません。",
                confirmLabel: revertStatus === "loading" ? "戻しています…" : "保存前の状態に戻す",
              }
            : null
        }
        onConfirm={handleConfirmRevert}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
