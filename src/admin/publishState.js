// usePublish用の、状態遷移・利用者向けメッセージだけを扱う純粋関数群。
// draftSaveState.jsと同じ方針（Reactから切り離してVitestで検証する）。

export const PUBLISH_ERROR_MESSAGES = {
  auth: "ログインの有効期限が切れている可能性があります。画面を再読み込みしてログインし直してください。",
  forbidden: "この会社を公開する権限がありません。",
  no_draft: "公開できる下書きが見つかりません。先に下書きを保存してください。",
  draft_save_failed: "下書きの保存に失敗したため、公開を中止しました。編集内容は保持されています。",
  network: "通信エラーが発生しました。通信状態を確認して再度お試しください。",
  unknown: "公開に失敗しました。しばらくしてから再度お試しください。",
};

export function resolvePublishErrorMessage(errorType) {
  if (!errorType) {
    return null;
  }
  return PUBLISH_ERROR_MESSAGES[errorType] || PUBLISH_ERROR_MESSAGES.unknown;
}

// Errorが1件でもあれば公開不可。加えて、Supabase側の保存先(companyDbId)が
// 解決できていない場合（ローカル開発モード・未登録会社）も公開できない。
export function canPublishDraft({ errorCount, companyDbId }) {
  return errorCount === 0 && Boolean(companyDbId);
}

// 公開直前の強制保存（自動保存を廃止したため、公開時点でdirtyなら
// 必ずここで明示保存してからでないとpublish_company_draft RPCを呼ばない）が
// 失敗した場合、公開処理そのものを中止すべきかを判定する。
// これにより「画面上の最新状態ではなく、Supabase上の古いdraft_configsを
// 誤って公開してしまう」事態を防ぐ。
// isDraftDirtyがfalse（＝publish時点で既に保存済み）の場合は、
// そもそも強制保存自体を試みないため、この判定は関係しない。
export function shouldAbortPublishAfterSaveAttempt({ isDraftDirty, saveSucceeded }) {
  return isDraftDirty && !saveSucceeded;
}
