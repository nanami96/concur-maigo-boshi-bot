// useDraftSave用の、状態遷移だけを扱う純粋関数群。
// Reactのstate/effectから切り離してあるので、Vitestで直接検証できる
// （このプロジェクトの既存テスト方針：pure関数のみをテストし、jsdom/RTLは使わない）。

// 編集内容(company/policies/expenseTypes/flow)のいずれかが変わった時に
// dirty（未保存の変更あり）とみなしてよいかを判定する。
// マウント直後の最初の1回（＝下書き/静的configを読み込んだだけ）は
// dirtyにしない（読み込んだ直後に無意味な保存が走るのを防ぐため）。
export function shouldMarkDirtyOnEditorChange({ isFirstRun }) {
  return !isFirstRun;
}

// 保存処理（saveDraft）の結果を受けて、次のsave状態を計算する。
// 成功時: dirty解除・保存時刻を更新
// 失敗時: dirtyは維持したまま（編集内容を失わない）、エラー種別だけ記録
export function computeStateAfterSaveResult({ error, updatedAt }) {
  if (error) {
    return { isDirty: true, saveStatus: "error", errorType: error.type, lastSavedAt: undefined };
  }
  return { isDirty: false, saveStatus: "idle", errorType: null, lastSavedAt: updatedAt };
}

// 現在保存を試みてよいか（Supabase設定済み、かつ対象会社のuuidが解決済みか）。
export function canAttemptSave({ isSupabaseConfigured, companyDbId }) {
  return Boolean(isSupabaseConfigured && companyDbId);
}

export const DRAFT_SAVE_ERROR_MESSAGES = {
  auth: "ログインの有効期限が切れている可能性があります。#adminを再読み込みしてログインし直してください（編集中の内容は失われません）。",
  network: "下書きの保存に失敗しました。通信状態を確認して再度お試しください。",
  unknown: "下書きの保存に失敗しました。しばらくしてから再度お試しください。",
};

export function resolveSaveErrorMessage(errorType) {
  if (!errorType) {
    return null;
  }
  return DRAFT_SAVE_ERROR_MESSAGES[errorType] || DRAFT_SAVE_ERROR_MESSAGES.unknown;
}
