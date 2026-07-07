function createIssue(level, id, target, message) {
  return {
    level,
    id,
    target,
    message,
  };
}

function buildQuestionGraph(questions, questionIds) {
  return new Map(
    questions.map((question) => [
      question.id,
      (question.options || [])
        .map((option) => option.nextQuestionId)
        .filter((nextQuestionId) => questionIds.has(nextQuestionId)),
    ]),
  );
}

function findReachableQuestionIds(questions, graph) {
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

function findQuestionFlowLoops(graph) {
  const loops = [];
  const visited = new Set();
  const visiting = new Set();
  const path = [];

  function visit(questionId) {
    if (visiting.has(questionId)) {
      const loopStartIndex = path.indexOf(questionId);
      loops.push([...path.slice(loopStartIndex), questionId]);
      return;
    }

    if (visited.has(questionId)) {
      return;
    }

    visiting.add(questionId);
    path.push(questionId);

    (graph.get(questionId) || []).forEach(visit);

    path.pop();
    visiting.delete(questionId);
    visited.add(questionId);
  }

  graph.forEach((_, questionId) => visit(questionId));

  return loops;
}

export function checkConfig(config) {
  const errors = [];
  const warnings = [];
  const questions = config.questions || [];
  const rules = config.rules || [];
  const expenseTypes = config.expenseTypes || [];
  const questionIds = new Set(questions.map((question) => question.id));
  const expenseTypeIds = new Set(
    expenseTypes.map((expenseType) => expenseType.id),
  );
  const usedQuestionIds = new Set();
  const usedExpenseTypeIds = new Set();

  if (questions.length === 0) {
    errors.push(
      createIssue(
        "error",
        "questions-empty",
        "questions",
        "質問が1件も設定されていません。",
      ),
    );
  }

  if (rules.length === 0) {
    errors.push(
      createIssue(
        "error",
        "rules-empty",
        "rules",
        "判定ルールが1件も設定されていません。",
      ),
    );
  }

  questions.forEach((question) => {
    (question.options || []).forEach((option) => {
      if (!option.nextQuestionId) {
        return;
      }

      if (!questionIds.has(option.nextQuestionId)) {
        errors.push(
          createIssue(
            "error",
            `missing-next-question-${question.id}-${option.value}`,
            question.id,
            `${question.id} の選択肢「${option.label}」が、存在しない次の質問ID ${option.nextQuestionId} を参照しています。`,
          ),
        );
      }
    });
  });

  rules.forEach((rule) => {
    Object.keys(rule.conditions || {}).forEach((questionId) => {
      usedQuestionIds.add(questionId);

      if (!questionIds.has(questionId)) {
        errors.push(
          createIssue(
            "error",
            `missing-condition-question-${rule.id}-${questionId}`,
            rule.id,
            `${rule.id} の条件が、存在しない質問ID ${questionId} を参照しています。`,
          ),
        );
      }
    });

    usedExpenseTypeIds.add(rule.resultExpenseTypeId);

    if (!expenseTypeIds.has(rule.resultExpenseTypeId)) {
      errors.push(
        createIssue(
          "error",
          `missing-result-expense-type-${rule.id}`,
          rule.id,
          `${rule.id} の結果が、存在しない経費タイプID ${rule.resultExpenseTypeId} を参照しています。`,
        ),
      );
    }
  });

  const graph = buildQuestionGraph(questions, questionIds);
  const loops = findQuestionFlowLoops(graph);

  loops.forEach((loop, index) => {
    errors.push(
      createIssue(
        "error",
        `question-flow-loop-${index + 1}`,
        loop[0],
        `質問フローが循環しています: ${loop.join(" → ")}`,
      ),
    );
  });

  const reachableQuestionIds = findReachableQuestionIds(questions, graph);

  questions.forEach((question) => {
    if (!usedQuestionIds.has(question.id)) {
      warnings.push(
        createIssue(
          "warning",
          `unused-question-${question.id}`,
          question.id,
          `${question.id} は判定ルールの条件で使用されていません。`,
        ),
      );
    }

    if (!reachableQuestionIds.has(question.id)) {
      warnings.push(
        createIssue(
          "warning",
          `unreachable-question-${question.id}`,
          question.id,
          `${question.id} は開始質問から到達できません。`,
        ),
      );
    }
  });

  expenseTypes.forEach((expenseType) => {
    if (!usedExpenseTypeIds.has(expenseType.id)) {
      warnings.push(
        createIssue(
          "warning",
          `unused-expense-type-${expenseType.id}`,
          expenseType.id,
          `${expenseType.id} は判定ルールの結果で使用されていません。`,
        ),
      );
    }
  });

  return {
    errors,
    warnings,
    info:
      errors.length === 0 && warnings.length === 0
        ? [
            createIssue(
              "info",
              "config-ok",
              "config",
              "設定チェックOK。Error / Warning はありません。",
            ),
          ]
        : [],
  };
}
