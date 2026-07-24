import { useState } from "react";
import ExcelImportPanel from "./ExcelImportPanel";
import UnsavedChangesDialog from "./UnsavedChangesDialog";
import { buildWorkspaceStateFromImport } from "./excelImportForExistingCompany";

// 既に設定がある会社の通常管理画面から、初期設定Excel（正式仕様）を
// 下書きへ取り込むための入口。
//
// 「＋新しい会社を作成」直後の初期セットアップ（InitialSetupScreen.jsx）と
// 同じExcelImportPanel（＝同じparseInitialSetupExcel・同じバリデーション・
// 同じImportPreview）をそのまま再利用する。通常管理画面専用の別パーサー・
// 別バリデーションは作らない。
//
// 新規セットアップとの違いは3点だけ：
//   1. 会社ID・会社名を「作成」するのではなく、現在編集中の会社の下書きへ
//      「反映」する（company_idは常に現在の会社のものへ固定し、Excel側の
//      値では絶対に上書きしない。excelImportForExistingCompany.js参照）。
//   2. 取り込みはeditor.loadState()で行う。useDraftSave側のdirty判定は
//      editorStateの参照比較（company/policies/expenseTypes/flowのいずれか）
//      で行われているため、これだけで自動的に「未保存の変更があります」
//      表示に切り替わる（保存/公開は既存の「下書きを保存」「公開する」を
//      そのまま使うので、ここでSupabaseへの書き込みは一切発生しない＝
//      即座に公開Botへ反映されることはない）。
//   3. 既に未保存の変更がある状態でインポートを開始しようとした場合は、
//      AdminRoot.jsxの会社切り替え時と同じUnsavedChangesDialogで
//      「保存して続ける／保存せず続ける／キャンセル」を確認してから進める
//      （無言で今の編集内容を破棄しない）。
export default function ExcelImportSection({ editor, persistence, companyId }) {
  // idle: 案内文＋開始ボタン / unsaved-confirm: 未保存確認ダイアログ表示中 /
  // importing: ExcelImportPanel表示中 / done: 反映直後の完了メッセージ表示中
  const [phase, setPhase] = useState("idle");
  const [isSavingBeforeImport, setIsSavingBeforeImport] = useState(false);
  const [saveBeforeImportError, setSaveBeforeImportError] = useState(null);

  function handleStartClick() {
    if (persistence.isDirty) {
      setSaveBeforeImportError(null);
      setPhase("unsaved-confirm");
      return;
    }
    setPhase("importing");
  }

  function handleCancelUnsavedConfirm() {
    setSaveBeforeImportError(null);
    setPhase("idle");
  }

  function handleDiscardAndContinue() {
    setSaveBeforeImportError(null);
    setPhase("importing");
  }

  async function handleSaveAndContinue() {
    setIsSavingBeforeImport(true);
    const success = await persistence.saveNow();
    setIsSavingBeforeImport(false);

    if (success) {
      setSaveBeforeImportError(null);
      setPhase("importing");
    } else {
      setSaveBeforeImportError(
        "保存に失敗しました。もう一度お試しいただくか、保存せず続けるを選んでください。",
      );
    }
  }

  function handleImportConfirm(bundle) {
    editor.loadState(buildWorkspaceStateFromImport({ bundle, currentCompanyId: companyId }));
    setPhase("done");
  }

  if (phase === "unsaved-confirm") {
    return (
      <UnsavedChangesDialog
        isSaving={isSavingBeforeImport}
        errorMessage={saveBeforeImportError}
        onCancel={handleCancelUnsavedConfirm}
        onDiscardAndContinue={handleDiscardAndContinue}
        onSaveAndContinue={handleSaveAndContinue}
      />
    );
  }

  if (phase === "importing") {
    return (
      <div className="excelImportSection">
        <button type="button" className="flowGhostButton" onClick={() => setPhase("idle")}>
          ← キャンセルして戻る
        </button>
        <ExcelImportPanel
          onConfirm={handleImportConfirm}
          currentCompanyId={companyId}
          confirmLabel="この内容を下書きに反映"
          noticeText="まだ下書きへは反映されていません。内容を確認してから「この内容を下書きに反映」を押してください。反映後も、公開するまで公開中のBotには影響しません。"
        />
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="excelImportSection">
        <p className="authSentMessage">
          Excelの内容を下書きへ反映しました。下の各タブで内容を確認し、必要に応じて修正してから「下書きを保存」・「公開する」を行ってください。
        </p>
        <button type="button" className="flowGhostButton" onClick={() => setPhase("idle")}>
          閉じる
        </button>
      </div>
    );
  }

  return (
    <div className="excelImportSection">
      <button type="button" className="flowGhostButton" onClick={handleStartClick}>
        Excelからインポート
      </button>
      <p className="settingsHint">
        初期設定Excel（正式仕様）から、この会社の設定を下書きへ取り込みます。取り込み後は保存・公開の操作を行うまで、公開中のBotには反映されません。
      </p>
    </div>
  );
}
