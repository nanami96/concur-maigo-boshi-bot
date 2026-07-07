function getExpenseTypeName(config, expenseTypeId) {
  return (
    config.expenseTypes.find((expenseType) => expenseType.id === expenseTypeId)
      ?.name || expenseTypeId
  );
}

function findResultRule(config, answers) {
  return [...config.rules]
    .filter((rule) => rule.active)
    .sort((left, right) => left.priority - right.priority)
    .find((rule) =>
      Object.entries(rule.conditions || {}).every(
        ([questionId, value]) => answers[questionId] === value,
      ),
    );
}

function buildResultNode(config, answers) {
  const rule = findResultRule(config, answers);

  if (!rule) {
    return {
      type: "missing-result",
      id: "missing-result",
      text: "一致する判定ルールがありません。",
    };
  }

  return {
    type: "result",
    id: rule.id,
    ruleId: rule.id,
    expenseTypeId: rule.resultExpenseTypeId,
    expenseTypeName: getExpenseTypeName(config, rule.resultExpenseTypeId),
  };
}

function buildQuestionNode(config, question, answers, path) {
  if (path.includes(question.id)) {
    return {
      type: "loop",
      id: question.id,
      text: `${question.id} への循環参照を検出しました。`,
    };
  }

  return {
    type: "question",
    id: question.id,
    text: question.text,
    children: (question.options || []).map((option) => {
      const nextAnswers = {
        ...answers,
        [question.id]: option.value,
      };
      const nextQuestion = config.questions.find(
        (item) => item.id === option.nextQuestionId,
      );

      return {
        type: "option",
        id: `${question.id}-${option.value}`,
        label: option.label,
        value: option.value,
        nextQuestionId: option.nextQuestionId || "",
        child: nextQuestion
          ? buildQuestionNode(config, nextQuestion, nextAnswers, [
              ...path,
              question.id,
            ])
          : buildResultNode(config, nextAnswers),
      };
    }),
  };
}

export function buildRuleFlowTree(config) {
  const firstQuestion = config.questions[0];

  return {
    type: "start",
    id: "start",
    text: "開始",
    child: firstQuestion
      ? buildQuestionNode(config, firstQuestion, {}, [])
      : {
          type: "missing-result",
          id: "missing-first-question",
          text: "開始質問が設定されていません。",
        },
  };
}
