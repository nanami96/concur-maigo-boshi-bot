import { useCallback, useState } from "react";
import * as flowMutations from "../flow/flowMutations";
import * as masterDataMutations from "../flow/masterDataMutations";

const HISTORY_LIMIT = 50;

// 管理画面ワークスペース全体（company / policies / expenseTypes / flow）を
// 単一のstateとして管理するフック。以前は flow だけを管理する useFlowEditor だったが、
// 基本設定・ポリシー・経費タイプも同じ画面から編集できるようにするため、
// 4つをまとめて1つのstate＋1つのUndo履歴として扱う形に拡張した。
//
// flow系のAPI（addOption, deleteOption 等）は名称・挙動とも従来のuseFlowEditorと
// 完全互換なので、FlowOutlineEditor / QuestionCard / OptionRow 等の既存コードは無改修で動く。
export function useWorkspaceEditor(initialState) {
  const [state, setState] = useState(initialState);
  const [history, setHistory] = useState([]);
  const [undoMessage, setUndoMessage] = useState(null);

  const apply = useCallback(
    (patch, label) => {
      setHistory((current) => [...current, state].slice(-HISTORY_LIMIT));
      setState((current) => ({ ...current, ...patch }));
      if (label) {
        setUndoMessage(label);
      }
    },
    [state],
  );

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.length === 0) {
        return current;
      }
      const previous = current[current.length - 1];
      setState(previous);
      setUndoMessage(null);
      return current.slice(0, -1);
    });
  }, []);

  const dismissUndoMessage = useCallback(() => setUndoMessage(null), []);

  // stateを丸ごと別の内容へ差し替え、Undo履歴もリセットする。
  // 「保存前の状態に戻す」のように、編集の積み重ね(apply)ではなく
  // 「新しい編集セッションの初期状態」として置き換えたい場合に使う。
  // applyを経由しないため、この置き換え自体はUndoできない
  // （元々の仕様: 置き換え前の状態へのUndoは不要）。
  const loadState = useCallback((nextState) => {
    setState(nextState);
    setHistory([]);
    setUndoMessage(null);
  }, []);

  // --- 質問フロー（既存useFlowEditorと同じ名前・挙動） -----------------------

  const addRootQuestion = useCallback(
    (text) => {
      const result = flowMutations.addRootQuestion(state.flow, text);
      apply({ flow: result.flow }, null);
      return result.questionId;
    },
    [state.flow, apply],
  );

  const updateQuestionText = useCallback(
    (questionId, text) => {
      apply({ flow: flowMutations.updateQuestionText(state.flow, questionId, text) }, null);
    },
    [state.flow, apply],
  );

  const addOption = useCallback(
    (questionId, label) => {
      const result = flowMutations.addOption(state.flow, questionId, label);
      apply({ flow: result.flow }, null);
      return result.optionId;
    },
    [state.flow, apply],
  );

  const updateOptionLabel = useCallback(
    (optionId, label) => {
      apply({ flow: flowMutations.updateOptionLabel(state.flow, optionId, label) }, null);
    },
    [state.flow, apply],
  );

  const reorderOption = useCallback(
    (questionId, fromIndex, toIndex) => {
      apply({ flow: flowMutations.reorderOption(state.flow, questionId, fromIndex, toIndex) }, null);
    },
    [state.flow, apply],
  );

  const computeBranchImpact = useCallback(
    (optionId) => flowMutations.computeBranchImpact(state.flow, optionId),
    [state.flow],
  );

  const deleteOption = useCallback(
    (questionId, optionId) => {
      apply(
        { flow: flowMutations.deleteOption(state.flow, questionId, optionId) },
        "選択肢を削除しました。",
      );
    },
    [state.flow, apply],
  );

  const setOptionNextToNewQuestion = useCallback(
    (optionId, text) => {
      const result = flowMutations.setOptionNextToNewQuestion(state.flow, optionId, text);
      apply({ flow: result.flow }, "「次の質問へ進む」に切り替えました。");
      return result.questionId;
    },
    [state.flow, apply],
  );

  const setOptionNextToResult = useCallback(
    (optionId) => {
      apply(
        { flow: flowMutations.setOptionNextToResult(state.flow, optionId) },
        "「結果を表示する」に切り替えました。",
      );
    },
    [state.flow, apply],
  );

  const updateResultCandidate = useCallback(
    (optionId, candidateIndex, patch) => {
      apply(
        { flow: flowMutations.updateResultCandidate(state.flow, optionId, candidateIndex, patch) },
        null,
      );
    },
    [state.flow, apply],
  );

  const addResultCandidate = useCallback(
    (optionId) => {
      apply({ flow: flowMutations.addResultCandidate(state.flow, optionId) }, null);
    },
    [state.flow, apply],
  );

  const removeResultCandidate = useCallback(
    (optionId, candidateIndex) => {
      apply(
        { flow: flowMutations.removeResultCandidate(state.flow, optionId, candidateIndex) },
        "候補を削除しました。",
      );
    },
    [state.flow, apply],
  );

  // --- 基本設定 -----------------------------------------------------------

  const updateCompanyName = useCallback(
    (name) => {
      apply({ company: masterDataMutations.updateCompanyName(state.company, name) }, null);
    },
    [state.company, apply],
  );

  // --- ポリシー -----------------------------------------------------------

  const addPolicy = useCallback(
    (policy) => {
      apply({ policies: masterDataMutations.addPolicy(state.policies, policy) }, null);
    },
    [state.policies, apply],
  );

  const updatePolicy = useCallback(
    (policyId, patch) => {
      apply({ policies: masterDataMutations.updatePolicy(state.policies, policyId, patch) }, null);
    },
    [state.policies, apply],
  );

  const computePolicyUsage = useCallback(
    (policyId) => masterDataMutations.countExpenseTypesUsingPolicy(state.expenseTypes, policyId),
    [state.expenseTypes],
  );

  const deletePolicy = useCallback(
    (policyId) => {
      apply(
        { policies: masterDataMutations.deletePolicy(state.policies, policyId) },
        "ポリシーを削除しました。",
      );
    },
    [state.policies, apply],
  );

  // --- 経費タイプ ---------------------------------------------------------

  const addExpenseType = useCallback(
    (expenseType) => {
      apply({ expenseTypes: masterDataMutations.addExpenseType(state.expenseTypes, expenseType) }, null);
    },
    [state.expenseTypes, apply],
  );

  const updateExpenseType = useCallback(
    (expenseTypeId, patch) => {
      apply(
        { expenseTypes: masterDataMutations.updateExpenseType(state.expenseTypes, expenseTypeId, patch) },
        null,
      );
    },
    [state.expenseTypes, apply],
  );

  const computeExpenseTypeUsage = useCallback(
    (expenseTypeId) => masterDataMutations.countFlowResultsUsingExpenseType(state.flow, expenseTypeId),
    [state.flow],
  );

  const deleteExpenseType = useCallback(
    (expenseTypeId) => {
      apply(
        { expenseTypes: masterDataMutations.deleteExpenseType(state.expenseTypes, expenseTypeId) },
        "経費タイプを削除しました。",
      );
    },
    [state.expenseTypes, apply],
  );

  return {
    company: state.company,
    policies: state.policies,
    expenseTypes: state.expenseTypes,
    flow: state.flow,

    canUndo: history.length > 0,
    undo,
    undoMessage,
    dismissUndoMessage,
    loadState,

    addRootQuestion,
    updateQuestionText,
    addOption,
    updateOptionLabel,
    reorderOption,
    computeBranchImpact,
    deleteOption,
    setOptionNextToNewQuestion,
    setOptionNextToResult,
    updateResultCandidate,
    addResultCandidate,
    removeResultCandidate,

    updateCompanyName,

    addPolicy,
    updatePolicy,
    deletePolicy,
    computePolicyUsage,

    addExpenseType,
    updateExpenseType,
    deleteExpenseType,
    computeExpenseTypeUsage,
  };
}
