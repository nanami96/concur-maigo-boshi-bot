import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { getCompanyDbId, saveDraft } from "../data/draftConfigRepository";
import {
  canAttemptSave,
  computeDirtyTransition,
  computeStateAfterSaveResult,
  resolveSaveErrorMessage,
} from "./draftSaveState";

// AdminWorkspaceの編集内容(company/policies/expenseTypes/flow)を
// Supabaseのdraft_configsへ保存する責務を持つフック。
//
// 以前は編集後2.5秒操作が無いと自動保存していたが、「最後に自分で保存した
// 状態」を編集途中の内容で意図せず上書きしてしまう問題があったため、
// 自動保存は廃止した（旧useDraftAutosaveをリネーム）。保存はユーザーが
// 「下書きを保存」を押した時（＝saveNow()の呼び出し時）だけ行われる。
//
// ・companyCodeから対象会社のcompanies.id（uuid）を解決する
//   （見つからない＝未登録 or 権限なしの場合は保存を無効化するだけで、
//   ローカルでの編集自体は妨げない）
// ・dirty判定: company/policies/expenseTypes/flowのいずれかの参照が、
//   直前に確定させたbaseline（＝最後に保存済み/読み込み済みとみなした内容）
//   から変わったら「未保存」とみなす（初回ロード・normalizeFlowによる
//   自動正規化・保存前の状態に戻す、等の「ユーザーが編集していない」変化は
//   baselineの更新だけに留め、dirty化しない）。
//   dirtyのまま何分・何時間経ってもSupabaseへは一切書き込まれない。
// ・saveNow()を呼んだ時だけdraft_configsへ保存する
//   （明示保存ボタン・公開直前の強制保存・会社切替時の「保存して移動」等、
//   全ての保存はこの1つの関数を経由する）。
export function useDraftSave({ companyCode, editorState, initialUpdatedAt }) {
  const [companyDbId, setCompanyDbId] = useState(null);
  // "checking" | "local" | "unregistered" | "error" | "ready"
  const [persistenceReason, setPersistenceReason] = useState(
    isSupabaseConfigured ? "checking" : "local",
  );

  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | error
  const [lastSavedAt, setLastSavedAt] = useState(initialUpdatedAt || null);
  const [errorType, setErrorType] = useState(null);

  const savingRef = useRef(false);
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;

  // dirty判定の基準となる「最後に保存済み/読み込み済みとみなした内容」への参照
  // （baseline）。computeDirtyTransition参照。
  const baselineRef = useRef({
    company: editorState.company,
    policies: editorState.policies,
    expenseTypes: editorState.expenseTypes,
    flow: editorState.flow,
  });
  // 「保存前の状態に戻す」等、外部からeditorStateを丸ごと差し替えた直後の
  // 1回だけ、その変化をdirty化しない（loadCleanStateが立てる）。
  const skipNextChangeRef = useRef(false);

  // --- 会社codeから保存先(companies.id)を解決する ---------------------------
  useEffect(() => {
    let cancelled = false;

    if (!isSupabaseConfigured) {
      setPersistenceReason("local");
      setCompanyDbId(null);
      return undefined;
    }

    if (!companyCode) {
      setPersistenceReason("unregistered");
      setCompanyDbId(null);
      return undefined;
    }

    setPersistenceReason("checking");

    getCompanyDbId(companyCode).then(({ id, error }) => {
      if (cancelled) {
        return;
      }
      if (error) {
        setPersistenceReason("error");
        setCompanyDbId(null);
        return;
      }
      if (!id) {
        setPersistenceReason("unregistered");
        setCompanyDbId(null);
        return;
      }
      setCompanyDbId(id);
      setPersistenceReason("ready");
    });

    return () => {
      cancelled = true;
    };
  }, [companyCode]);

  const canSave = canAttemptSave({ isSupabaseConfigured, companyDbId });

  // --- dirty判定 -----------------------------------------------------------
  // ここではdirtyフラグを立てるだけで、保存は一切行わない
  // （以前はこの変化を起点に自動保存タイマーを張っていたが、今は張らない）。
  //
  // baselineRef.currentとの参照比較（computeDirtyTransition）で判定する。
  // React.StrictMode下でこのeffect自体が（依存配列が変わらないまま）2回
  // 実行されても、2回目の時点でeditorStateとbaselineの参照は一致したままの
  // ため、誤ってdirty化されることはない。
  useEffect(() => {
    const transition = computeDirtyTransition({
      editorState,
      baseline: baselineRef.current,
      skipNextChange: skipNextChangeRef.current,
    });

    if (!transition.changed) {
      return;
    }

    if (transition.shouldMarkDirty) {
      setIsDirty(true);
    }
    baselineRef.current = transition.nextBaseline;
    skipNextChangeRef.current = transition.nextSkipNextChange;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorState.company, editorState.policies, editorState.expenseTypes, editorState.flow]);

  // --- 保存本体（呼び出されるのは明示的な操作からのみ） -------------------------
  // 呼び出し元: DraftSaveBarの「下書きを保存」ボタン、公開直前の強制保存
  // （usePublish）、会社切替ガードの「保存して移動」（AdminRoot）。
  const saveNow = useCallback(async () => {
    if (!canSave || savingRef.current) {
      return false;
    }

    savingRef.current = true;
    setSaveStatus("saving");
    setErrorType(null);

    // 保存に送る内容と、成功時にbaselineへ反映する内容は、必ずこの呼び出し開始時点の
    // 値で揃える（await中にユーザーがさらに編集してeditorStateRef.currentが
    // 進んでしまっても、baselineが「実際に保存した内容」からずれないようにするため）。
    const stateAtSaveStart = editorStateRef.current;
    const { row, error } = await saveDraft(companyDbId, stateAtSaveStart);
    savingRef.current = false;

    if (error) {
      console.error("下書きの保存に失敗しました", error);
    }

    const next = computeStateAfterSaveResult({ error, updatedAt: row?.updated_at });
    setIsDirty(next.isDirty);
    setSaveStatus(next.saveStatus);
    setErrorType(next.errorType);
    if (next.lastSavedAt !== undefined) {
      setLastSavedAt(next.lastSavedAt);
    }

    if (!error) {
      baselineRef.current = {
        company: stateAtSaveStart.company,
        policies: stateAtSaveStart.policies,
        expenseTypes: stateAtSaveStart.expenseTypes,
        flow: stateAtSaveStart.flow,
      };
    }

    return !error;
  }, [canSave, companyDbId]);

  // 「保存前の状態に戻す」のように、外部（AdminWorkspace）が
  // editor.loadState()でstateを丸ごと差し替えた直後に呼ぶ。
  // dirty判定のuseEffectは、editorStateの参照が変わるたびに発火するが、
  // skipNextChangeRefを立てておくことで「読み込み直しただけ」として
  // 次の1回だけdirty化をスキップし、baselineの更新だけに留めさせる。
  const loadCleanState = useCallback((updatedAt) => {
    skipNextChangeRef.current = true;
    setIsDirty(false);
    setSaveStatus("idle");
    setErrorType(null);
    setLastSavedAt(updatedAt ?? null);
  }, []);

  return {
    canSave,
    companyDbId,
    persistenceReason,
    isDirty,
    saveStatus,
    lastSavedAt,
    errorMessage: resolveSaveErrorMessage(errorType),
    saveNow,
    loadCleanState,
  };
}
