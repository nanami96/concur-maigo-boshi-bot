// useDraftSave用の、状態遷移だけを扱う純粋関数群。
// Reactのstate/effectから切り離してあるので、Vitestで直接検証できる
// （このプロジェクトの既存テスト方針：pure関数のみをテストし、jsdom/RTLは使わない）。

// editorState(company/policies/expenseTypes/flow)の現在値と、直前に確定させた
// baseline（＝最後に「保存済み/読み込み済み」とみなした内容）を参照比較し、
// dirty化すべきかどうかを判定する純粋関数。
//
// 以前は「マウント直後の1回目かどうか」を示すisFirstRunフラグ（useEffect内で
// true→falseに一度だけ切り替える方式）で判定していたが、これは
// React.StrictMode（開発時のみ、mount直後にuseEffectをもう一度実行して
// 副作用の副作用を検出する仕組み）と相性が悪かった：1回目の実行でfalseに
// なった直後、StrictModeによる2回目の実行を「もう初回ではない＝編集された」
// と誤認し、実際には何も編集していないのにdirty=trueになってしまっていた
// （特定の会社のデータに依存しない構造的な不具合で、会社を開いた直後に必ず再現する）。
//
// baseline比較方式であれば、2回目の実行時点でもeditorStateとbaselineの
// 参照は完全に一致したままなので（何も変更されていないため）、
// 「実行された回数」に関係なく正しくdirty=falseのままになる。
//
// skipNextChange: 「保存前の状態に戻す」等、外部から丸ごとeditorStateを
// 差し替えた直後の変化を1回だけdirty化せず、baselineの更新だけに留めるための
// フラグ。呼び出し側（useDraftSave）が、状態の差し替えを行うタイミングで
// true にしてから渡す。
export function computeDirtyTransition({ editorState, baseline, skipNextChange }) {
  const changed =
    editorState.company !== baseline.company ||
    editorState.policies !== baseline.policies ||
    editorState.expenseTypes !== baseline.expenseTypes ||
    editorState.flow !== baseline.flow;

  if (!changed) {
    return {
      changed: false,
      shouldMarkDirty: false,
      nextBaseline: baseline,
      nextSkipNextChange: skipNextChange,
    };
  }

  return {
    changed: true,
    shouldMarkDirty: !skipNextChange,
    nextBaseline: {
      company: editorState.company,
      policies: editorState.policies,
      expenseTypes: editorState.expenseTypes,
      flow: editorState.flow,
    },
    nextSkipNextChange: false,
  };
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
