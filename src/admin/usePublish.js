import { useCallback, useEffect, useMemo, useState } from "react";
import { buildConfigFromFlow } from "../flow/buildConfigFromFlow";
import { runConfigChecks } from "../flow/runConfigChecks";
import {
  fetchCurrentPublishedVersionId,
  fetchPublishHistory,
  publishDraft,
} from "../data/publishRepository";
import {
  canPublishDraft,
  resolvePublishErrorMessage,
  shouldAbortPublishAfterSaveAttempt,
} from "./publishState";

// 下書き(useWorkspaceEditorの現在state)を正式公開する責務を持つフック。
//
// ・設定チェック（runConfigChecks）をリアルタイムに実行し、Errorが1件でもあれば
//   公開不可にする（Warningのみなら公開可、確認は呼び出し側のUIが担当）。
// ・公開前に必ず最新のstateを保存してから公開する
//   （「画面上のstate」と「公開する下書き」がズレないようにするため。
//   保存に失敗した場合は公開処理そのものを中止し、編集内容は一切変更しない）。
// ・公開処理自体はuseWorkspaceEditorのstate/Undo履歴を一切書き換えない。
export function usePublish({ companyDbId, editorState, isDraftDirty, saveNow }) {
  const { errors, warnings } = useMemo(
    () => runConfigChecks(editorState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorState.company, editorState.policies, editorState.expenseTypes, editorState.flow],
  );

  const [publishStatus, setPublishStatus] = useState("idle"); // idle | publishing | error
  const [errorType, setErrorType] = useState(null);
  const [lastPublishedAt, setLastPublishedAt] = useState(null);
  const [history, setHistory] = useState([]);
  const [currentPublishedVersionId, setCurrentPublishedVersionId] = useState(null);

  // 会社が確定した時点で、既存の公開履歴・現在の公開バージョンを読み込む
  // （このセッションで一度も公開していなくても、過去に公開済みなら反映する）。
  useEffect(() => {
    let cancelled = false;

    if (!companyDbId) {
      setHistory([]);
      setCurrentPublishedVersionId(null);
      setLastPublishedAt(null);
      return undefined;
    }

    Promise.all([fetchPublishHistory(companyDbId), fetchCurrentPublishedVersionId(companyDbId)]).then(
      ([historyResult, currentResult]) => {
        if (cancelled) {
          return;
        }
        if (!historyResult.error) {
          setHistory(historyResult.rows);
          if (historyResult.rows.length > 0) {
            setLastPublishedAt(historyResult.rows[0].published_at);
          }
        }
        if (!currentResult.error) {
          setCurrentPublishedVersionId(currentResult.currentPublishedVersionId);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [companyDbId]);

  const canPublish = canPublishDraft({ errorCount: errors.length, companyDbId });

  const publish = useCallback(async () => {
    if (!canPublish) {
      return { success: false };
    }

    setPublishStatus("publishing");
    setErrorType(null);

    if (isDraftDirty) {
      const saved = await saveNow?.();
      if (shouldAbortPublishAfterSaveAttempt({ isDraftDirty, saveSucceeded: saved })) {
        setPublishStatus("error");
        setErrorType("draft_save_failed");
        return { success: false };
      }
    }

    const configSnapshot = buildConfigFromFlow(editorState.flow, {
      company: editorState.company,
      policies: editorState.policies,
      expenseTypes: editorState.expenseTypes,
    });

    const { row, error } = await publishDraft({ companyDbId, configSnapshot });

    if (error) {
      console.error("公開に失敗しました", error);
      setPublishStatus("error");
      setErrorType(error.type);
      return { success: false };
    }

    setPublishStatus("idle");
    setErrorType(null);
    setLastPublishedAt(row.published_at);
    setCurrentPublishedVersionId(row.id);
    setHistory((current) => [
      { id: row.id, published_at: row.published_at, published_by: row.published_by },
      ...current,
    ]);

    return { success: true };
  }, [canPublish, isDraftDirty, saveNow, editorState, companyDbId]);

  return {
    errors,
    warnings,
    canPublish,
    publishStatus,
    errorMessage: resolvePublishErrorMessage(errorType),
    lastPublishedAt,
    history,
    currentPublishedVersionId,
    publish,
  };
}
