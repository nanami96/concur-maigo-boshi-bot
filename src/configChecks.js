export function checkConfig(config) {
  const issues = [];
  const questions = config.questions || [];
  const rules = config.rules || [];
  const expenseTypes = config.expenseTypes || [];
  const questionIds = new Set(questions.map((question) => question.id));
  const expenseTypeIds = new Set(
    expenseTypes.map((expenseType) => expenseType.id),
  );

  if (questions.length === 0) {
    issues.push({
      id: "questions-empty",
      target: "questions",
      message: "質問が1件も設定されていません。",
    });
  }

  if (rules.length === 0) {
    issues.push({
      id: "rules-empty",
      target: "rules",
      message: "判定ルールが1件も設定されていません。",
    });
  }

  questions.forEach((question) => {
    (question.options || []).forEach((option) => {
      if (!option.nextQuestionId) {
        return;
      }

      if (!questionIds.has(option.nextQuestionId)) {
        issues.push({
          id: `missing-next-question-${question.id}-${option.value}`,
          target: question.id,
          message: `${question.id} の選択肢「${option.label}」が、存在しない次の質問ID ${option.nextQuestionId} を参照しています。`,
        });
      }
    });
  });

  rules.forEach((rule) => {
    Object.keys(rule.conditions || {}).forEach((questionId) => {
      if (!questionIds.has(questionId)) {
        issues.push({
          id: `missing-condition-question-${rule.id}-${questionId}`,
          target: rule.id,
          message: `${rule.id} の条件が、存在しない質問ID ${questionId} を参照しています。`,
        });
      }
    });

    if (!expenseTypeIds.has(rule.resultExpenseTypeId)) {
      issues.push({
        id: `missing-result-expense-type-${rule.id}`,
        target: rule.id,
        message: `${rule.id} の結果が、存在しない経費タイプID ${rule.resultExpenseTypeId} を参照しています。`,
      });
    }
  });

  return issues;
}
