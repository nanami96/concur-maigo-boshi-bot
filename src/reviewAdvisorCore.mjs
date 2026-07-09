function buildGraph(questions) {
  const questionIds = new Set(questions.map((question) => question.id));

  return new Map(
    questions.map((question) => [
      question.id,
      (question.options || [])
        .map((option) => option.nextQuestionId)
        .filter((nextQuestionId) => questionIds.has(nextQuestionId)),
    ]),
  );
}

function findReachableQuestionIds(questions) {
  const graph = buildGraph(questions);
  const firstQuestion = questions[0];
  const reachable = new Set();
  const queue = firstQuestion ? [firstQuestion.id] : [];

  while (queue.length > 0) {
    const questionId = queue.shift();

    if (reachable.has(questionId)) {
      continue;
    }

    reachable.add(questionId);

    (graph.get(questionId) || []).forEach((nextQuestionId) => {
      if (!reachable.has(nextQuestionId)) {
        queue.push(nextQuestionId);
      }
    });
  }

  return reachable;
}

function getUsage(config) {
  const usedQuestionIds = new Set();
  const usedExpenseTypeIds = new Set();

  (config.rules || []).forEach((rule) => {
    Object.keys(rule.conditions || {}).forEach((questionId) =>
      usedQuestionIds.add(questionId),
    );
    usedExpenseTypeIds.add(rule.resultExpenseTypeId);
  });

  return {
    usedQuestionIds,
    usedExpenseTypeIds,
  };
}

function hasSimpleLinearStart(questions) {
  const firstQuestion = questions[0];

  return Boolean(firstQuestion && (firstQuestion.options || []).length > 0);
}

export function generateReviewComments(config) {
  const questions = config.questions || [];
  const rules = config.rules || [];
  const expenseTypes = config.expenseTypes || [];
  const { usedQuestionIds, usedExpenseTypeIds } = getUsage(config);
  const reachableQuestionIds = findReachableQuestionIds(questions);
  const unusedQuestions = questions.filter(
    (question) => !usedQuestionIds.has(question.id),
  );
  const unusedExpenseTypes = expenseTypes.filter(
    (expenseType) => !usedExpenseTypeIds.has(expenseType.id),
  );
  const unreachableQuestions = questions.filter(
    (question) => !reachableQuestionIds.has(question.id),
  );
  const goodPoints = [];
  const improvementCandidates = [];

  if (hasSimpleLinearStart(questions)) {
    goodPoints.push("判定フローの開始質問と選択肢が定義されています。");
  }

  if (unusedQuestions.length === 0 && questions.length > 0) {
    goodPoints.push("未使用質問はありません。");
  }

  if (unreachableQuestions.length === 0 && questions.length > 0) {
    goodPoints.push("開始質問から到達できない質問はありません。");
  }

  if (rules.length > 0 && expenseTypes.length > 0) {
    goodPoints.push("判定ルールと経費タイプの対応が定義されています。");
  }

  if (unusedQuestions.length > 0) {
    improvementCandidates.push(
      `未使用質問があります: ${unusedQuestions.map((question) => question.id).join(", ")}`,
    );
  }

  if (unusedExpenseTypes.length > 0) {
    improvementCandidates.push(
      `未使用経費タイプがあります: ${unusedExpenseTypes
        .map((expenseType) => expenseType.id)
        .join(", ")}`,
    );
  }

  if (unreachableQuestions.length > 0) {
    improvementCandidates.push(
      `到達不能質問があります: ${unreachableQuestions
        .map((question) => question.id)
        .join(", ")}`,
    );
  }

  if (rules.length >= 10) {
    improvementCandidates.push(
      "Rule数が多いため、条件の統合や分割方針の見直しを検討してください。",
    );
  }

  if (questions.length === 0) {
    improvementCandidates.push("質問が設定されていません。開始質問を定義してください。");
  }

  if (rules.length === 0) {
    improvementCandidates.push("判定ルールが設定されていません。");
  }

  if (goodPoints.length === 0) {
    goodPoints.push("レビュー可能な設定項目が生成されています。");
  }

  return {
    goodPoints,
    improvementCandidates,
  };
}
