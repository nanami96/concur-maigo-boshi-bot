// flow データの設定チェック。既存の scripts/generators/relationalSchema.js の
// validateNewSchema と考え方は同じだが、
// 管理者には質問ID・選択肢IDを一切見せない自然文でメッセージを組み立てる。
function describeQuestion(question) {
  if (!question || !question.text || !question.text.trim()) {
    return "質問文が未入力の質問";
  }

  return `質問「${question.text}」`;
}

function describeOption(option) {
  if (!option || !option.label || !option.label.trim()) {
    return "文言が未入力の選択肢";
  }

  return `選択肢「${option.label}」`;
}

function createIssue(level, id, message, questionId, optionId) {
  return { level, id, message, questionId, optionId: optionId ?? null };
}

export function checkFlow(flow, expenseTypes = []) {
  const errors = [];
  const warnings = [];

  if (!flow.rootQuestionId || !flow.questions[flow.rootQuestionId]) {
    errors.push(
      createIssue(
        "error",
        "no-root",
        "最初の質問がまだ作成されていません。",
        null,
      ),
    );

    return { errors, warnings };
  }

  const expenseTypeIds = new Set(expenseTypes.map((item) => item.id));
  const usedExpenseTypeIds = new Set();

  Object.entries(flow.questions).forEach(([questionId, question]) => {
    if (!question.text || !question.text.trim()) {
      errors.push(
        createIssue(
          "error",
          `question-text-${questionId}`,
          `${describeQuestion(question)}の質問文が入力されていません。`,
          questionId,
        ),
      );
    }

    if (question.optionIds.length === 0) {
      warnings.push(
        createIssue(
          "warning",
          `question-no-options-${questionId}`,
          `${describeQuestion(question)}に選択肢がありません。`,
          questionId,
        ),
      );
    }

    question.optionIds.forEach((optionId) => {
      const option = flow.options[optionId];

      if (!option) {
        return;
      }

      if (!option.label || !option.label.trim()) {
        errors.push(
          createIssue(
            "error",
            `option-label-${optionId}`,
            `${describeQuestion(question)}の選択肢に文言が入力されていないものがあります。`,
            questionId,
            optionId,
          ),
        );
      }

      if (!option.next || option.next.type === "unset") {
        errors.push(
          createIssue(
            "error",
            `option-next-${optionId}`,
            `${describeQuestion(question)}の${describeOption(option)}で、次の質問または結果が設定されていません。`,
            questionId,
            optionId,
          ),
        );
        return;
      }

      if (option.next.type === "result") {
        (option.next.candidates || []).forEach((candidate, index) => {
          if (!candidate.expenseTypeId) {
            errors.push(
              createIssue(
                "error",
                `candidate-expense-${optionId}-${index}`,
                `${describeQuestion(question)}の${describeOption(option)}の結果で、経費タイプが選択されていません。`,
                questionId,
                optionId,
              ),
            );
            return;
          }

          usedExpenseTypeIds.add(candidate.expenseTypeId);

          if (!expenseTypeIds.has(candidate.expenseTypeId)) {
            errors.push(
              createIssue(
                "error",
                `candidate-expense-missing-${optionId}-${index}`,
                `${describeQuestion(question)}の${describeOption(option)}の結果が、存在しない経費タイプを参照しています。`,
                questionId,
                optionId,
              ),
            );
          }
        });
      }
    });
  });

  expenseTypes.forEach((expenseType) => {
    if (!usedExpenseTypeIds.has(expenseType.id)) {
      warnings.push(
        createIssue(
          "warning",
          `unused-expense-type-${expenseType.id}`,
          `経費タイプ「${expenseType.name}」はどの結果からも使われていません。`,
          null,
        ),
      );
    }
  });

  return { errors, warnings };
}
