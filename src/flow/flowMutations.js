// flow データを直接書き換えず、常に新しいflowオブジェクトを返す純粋関数群。
// 管理画面のReact state（useFlowEditorフック）から呼び出される想定。
import { generateNextId } from "./idGenerator";

export function createEmptyFlow() {
  return { rootQuestionId: null, questions: {}, options: {} };
}

function cloneFlow(flow) {
  return {
    rootQuestionId: flow.rootQuestionId,
    questions: { ...flow.questions },
    options: { ...flow.options },
  };
}

export function addRootQuestion(flow, text = "") {
  const questionId = generateNextId(Object.keys(flow.questions), "Q");
  const next = cloneFlow(flow);

  next.questions[questionId] = { text, type: "single_select", optionIds: [] };
  next.rootQuestionId = questionId;

  return { flow: next, questionId };
}

export function updateQuestionText(flow, questionId, text) {
  const next = cloneFlow(flow);
  next.questions[questionId] = { ...next.questions[questionId], text };
  return next;
}

export function addOption(flow, questionId, label = "") {
  const optionId = generateNextId(Object.keys(flow.options), "O");
  const next = cloneFlow(flow);
  const question = next.questions[questionId];

  next.questions[questionId] = {
    ...question,
    optionIds: [...question.optionIds, optionId],
  };
  next.options[optionId] = { label, next: { type: "unset" } };

  return { flow: next, optionId };
}

export function updateOptionLabel(flow, optionId, label) {
  const next = cloneFlow(flow);
  next.options[optionId] = { ...next.options[optionId], label };
  return next;
}

export function reorderOption(flow, questionId, fromIndex, toIndex) {
  if (fromIndex === toIndex) {
    return flow;
  }

  const next = cloneFlow(flow);
  const optionIds = [...next.questions[questionId].optionIds];
  const [moved] = optionIds.splice(fromIndex, 1);
  optionIds.splice(toIndex, 0, moved);
  next.questions[questionId] = { ...next.questions[questionId], optionIds };

  return next;
}

// --- 削除・切替の影響範囲計算 -----------------------------------------
//
// 木構造である前提を利用し、「この選択肢の配下に何がぶら下がっているか」を
// 質問数・選択肢数・結果数として数える。UIはこれを見せてから削除/切替の確認を取る。

function collectSubtree(flow, optionId, acc) {
  const option = flow.options[optionId];

  if (!option || option.next?.type !== "question") {
    return acc;
  }

  const childQuestionId = option.next.questionId;
  const childQuestion = flow.questions[childQuestionId];

  if (!childQuestion) {
    return acc;
  }

  acc.questionIds.push(childQuestionId);

  childQuestion.optionIds.forEach((childOptionId) => {
    acc.optionIds.push(childOptionId);
    collectSubtree(flow, childOptionId, acc);
  });

  return acc;
}

export function computeBranchImpact(flow, optionId) {
  const option = flow.options[optionId];

  if (!option || !option.next) {
    return { questionCount: 0, optionCount: 0, resultCount: 0 };
  }

  if (option.next.type === "result") {
    return { questionCount: 0, optionCount: 0, resultCount: 1 };
  }

  if (option.next.type !== "question") {
    return { questionCount: 0, optionCount: 0, resultCount: 0 };
  }

  const { questionIds, optionIds } = collectSubtree(flow, optionId, {
    questionIds: [],
    optionIds: [],
  });
  const resultCount = optionIds.filter(
    (id) => flow.options[id]?.next?.type === "result",
  ).length;

  return {
    questionCount: questionIds.length,
    optionCount: optionIds.length,
    resultCount,
  };
}

function removeSubtree(flow, optionId) {
  const option = flow.options[optionId];

  if (!option || option.next?.type !== "question") {
    return flow;
  }

  const { questionIds, optionIds } = collectSubtree(flow, optionId, {
    questionIds: [],
    optionIds: [],
  });
  const next = cloneFlow(flow);

  questionIds.forEach((id) => delete next.questions[id]);
  optionIds.forEach((id) => delete next.options[id]);

  return next;
}

// 選択肢そのものを削除する（配下の質問・選択肢・結果も含めて削除する）。
export function deleteOption(flow, questionId, optionId) {
  const withoutSubtree = removeSubtree(flow, optionId);
  const next = cloneFlow(withoutSubtree);

  next.questions[questionId] = {
    ...next.questions[questionId],
    optionIds: next.questions[questionId].optionIds.filter((id) => id !== optionId),
  };
  delete next.options[optionId];

  return next;
}

// --- 「次の質問へ進む」⇔「結果を表示する」の切替 -----------------------
// 切替前に必ず computeBranchImpact() で影響件数を確認・表示してから呼び出すこと。

export function setOptionNextToNewQuestion(flow, optionId, text = "") {
  const cleared = removeSubtree(flow, optionId);
  const questionId = generateNextId(Object.keys(cleared.questions), "Q");
  const next = cloneFlow(cleared);

  next.questions[questionId] = { text, type: "single_select", optionIds: [] };
  next.options[optionId] = {
    ...next.options[optionId],
    next: { type: "question", questionId },
  };

  return { flow: next, questionId };
}

export function setOptionNextToResult(flow, optionId) {
  const cleared = removeSubtree(flow, optionId);
  const next = cloneFlow(cleared);

  next.options[optionId] = {
    ...next.options[optionId],
    next: {
      type: "result",
      candidates: [{ expenseTypeId: "", message: "", warningMessage: "" }],
    },
  };

  return next;
}

export function updateResultCandidate(flow, optionId, candidateIndex, patch) {
  const next = cloneFlow(flow);
  const option = next.options[optionId];
  const candidates = option.next.candidates.map((candidate, index) =>
    index === candidateIndex ? { ...candidate, ...patch } : candidate,
  );

  next.options[optionId] = { ...option, next: { ...option.next, candidates } };

  return next;
}

export function addResultCandidate(flow, optionId) {
  const next = cloneFlow(flow);
  const option = next.options[optionId];

  next.options[optionId] = {
    ...option,
    next: {
      ...option.next,
      candidates: [
        ...option.next.candidates,
        { expenseTypeId: "", message: "", warningMessage: "" },
      ],
    },
  };

  return next;
}

export function removeResultCandidate(flow, optionId, candidateIndex) {
  const next = cloneFlow(flow);
  const option = next.options[optionId];

  next.options[optionId] = {
    ...option,
    next: {
      ...option.next,
      candidates: option.next.candidates.filter((_, index) => index !== candidateIndex),
    },
  };

  return next;
}
