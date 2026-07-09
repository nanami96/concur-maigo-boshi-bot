const VALID_SEVERITIES = new Set(["high", "medium", "low"]);

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

function findQuestionLoops(questions) {
  const graph = buildGraph(questions);
  const visiting = new Set();
  const visited = new Set();
  const loops = new Set();

  function visit(questionId, path) {
    if (visiting.has(questionId)) {
      const loopStart = path.indexOf(questionId);
      const loopPath = [...path.slice(loopStart), questionId];
      loops.add(loopPath.join(" -> "));
      return;
    }

    if (visited.has(questionId)) {
      return;
    }

    visiting.add(questionId);

    (graph.get(questionId) || []).forEach((nextQuestionId) => {
      visit(nextQuestionId, [...path, nextQuestionId]);
    });

    visiting.delete(questionId);
    visited.add(questionId);
  }

  questions.forEach((question) => visit(question.id, [question.id]));

  return [...loops];
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

function createImprovement(message, severity) {
  if (!VALID_SEVERITIES.has(severity)) {
    throw new Error(`Invalid review severity: ${severity}`);
  }

  return {
    message,
    severity,
  };
}

function findInvalidReferences(config) {
  const questions = config.questions || [];
  const rules = config.rules || [];
  const expenseTypes = config.expenseTypes || [];
  const questionIds = new Set(questions.map((question) => question.id));
  const expenseTypeIds = new Set(
    expenseTypes.map((expenseType) => expenseType.id),
  );
  const invalidNextQuestionRefs = [];
  const invalidRuleQuestionRefs = [];
  const invalidRuleExpenseTypeRefs = [];

  questions.forEach((question) => {
    (question.options || []).forEach((option) => {
      if (option.nextQuestionId && !questionIds.has(option.nextQuestionId)) {
        invalidNextQuestionRefs.push(
          `${question.id}.${option.value} -> ${option.nextQuestionId}`,
        );
      }
    });
  });

  rules.forEach((rule) => {
    Object.keys(rule.conditions || {}).forEach((questionId) => {
      if (!questionIds.has(questionId)) {
        invalidRuleQuestionRefs.push(`${rule.id} -> ${questionId}`);
      }
    });

    if (
      rule.resultExpenseTypeId &&
      !expenseTypeIds.has(rule.resultExpenseTypeId)
    ) {
      invalidRuleExpenseTypeRefs.push(
        `${rule.id} -> ${rule.resultExpenseTypeId}`,
      );
    }
  });

  return {
    invalidNextQuestionRefs,
    invalidRuleQuestionRefs,
    invalidRuleExpenseTypeRefs,
  };
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
  const questionLoops = findQuestionLoops(questions);
  const {
    invalidNextQuestionRefs,
    invalidRuleQuestionRefs,
    invalidRuleExpenseTypeRefs,
  } = findInvalidReferences(config);
  const goodPoints = [];
  const improvementCandidates = [];

  if (hasSimpleLinearStart(questions)) {
    goodPoints.push(
      "判定フローの開始質問と選択肢が定義されています。",
    );
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

  if (invalidNextQuestionRefs.length > 0) {
    improvementCandidates.push(
      createImprovement(
        `存在しない nextQuestionId を参照しています: ${invalidNextQuestionRefs.join(", ")}`,
        "high",
      ),
    );
  }

  if (invalidRuleQuestionRefs.length > 0) {
    improvementCandidates.push(
      createImprovement(
        `Rule が存在しない質問IDを参照しています: ${invalidRuleQuestionRefs.join(", ")}`,
        "high",
      ),
    );
  }

  if (invalidRuleExpenseTypeRefs.length > 0) {
    improvementCandidates.push(
      createImprovement(
        `Rule が存在しない経費タイプIDを参照しています: ${invalidRuleExpenseTypeRefs.join(", ")}`,
        "high",
      ),
    );
  }

  if (questionLoops.length > 0) {
    improvementCandidates.push(
      createImprovement(
        `質問フローに循環参照があります: ${questionLoops.join(", ")}`,
        "high",
      ),
    );
  }

  if (unusedQuestions.length > 0) {
    improvementCandidates.push(
      createImprovement(
        `未使用質問があります: ${unusedQuestions.map((question) => question.id).join(", ")}`,
        "medium",
      ),
    );
  }

  if (unusedExpenseTypes.length > 0) {
    improvementCandidates.push(
      createImprovement(
        `未使用経費タイプがあります: ${unusedExpenseTypes
          .map((expenseType) => expenseType.id)
          .join(", ")}`,
        "medium",
      ),
    );
  }

  if (unreachableQuestions.length > 0) {
    improvementCandidates.push(
      createImprovement(
        `到達不能質問があります: ${unreachableQuestions
          .map((question) => question.id)
          .join(", ")}`,
        "medium",
      ),
    );
  }

  if (rules.length >= 10) {
    improvementCandidates.push(
      createImprovement(
        "Rule数が多いため、条件の統合や分割方針の見直しを検討してください。",
        "low",
      ),
    );
  }

  if (questions.length === 0) {
    improvementCandidates.push(
      createImprovement(
        "質問が設定されていません。開始質問を定義してください。",
        "high",
      ),
    );
  }

  if (rules.length === 0) {
    improvementCandidates.push(
      createImprovement("判定ルールが設定されていません。", "high"),
    );
  }

  if (goodPoints.length === 0) {
    goodPoints.push("レビュー可能な設定項目が生成されています。");
  }

  return {
    goodPoints,
    improvementCandidates,
  };
}
