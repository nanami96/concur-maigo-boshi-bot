import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { getCompanyDbId, saveDraft } from "../data/draftConfigRepository";
import {
  canAttemptSave,
  computeStateAfterSaveResult,
  resolveSaveErrorMessage,
  shouldMarkDirtyOnEditorChange,
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
// ・dirty判定: company/policies/expenseTypes/flowのいずれかの参照が
//   変わったら「未保存」とみなす（マウント直後の1回目は除く）。
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

  const isFirstEditorRun = useRef(true);
  const savingRef = useRef(false);
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;

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
  useEffect(() => {
    if (shouldMarkDirtyOnEditorChange({ isFirstRun: isFirstEditorRun.current })) {
      setIsDirty(true);
    }
    isFirstEditorRun.current = false;
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

    const { row, error } = await saveDraft(companyDbId, editorStateRef.current);
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

    return !error;
  }, [canSave, companyDbId]);

  // 「保存前の状態に戻す」のように、外部（AdminWorkspace）が
  // editor.loadState()でstateを丸ごと差し替えた直後に呼ぶ。
  // dirty判定のuseEffectは、editorStateの参照が変わるたびに発火するが、
  // isFirstEditorRunを再度trueにしておくことで「読み込み直しただけ」として
  // 次の1回だけdirty化をスキップさせる（マウント直後の初回と全く同じ仕組み）。
  const loadCleanState = useCallback((updatedAt) => {
    isFirstEditorRun.current = true;
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
