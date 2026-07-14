function getExpenseTypeName(config, expenseTypeId) {
  return (
    config.expenseTypes.find((expenseType) => expenseType.id === expenseTypeId)
      ?.name || expenseTypeId
  );
}

function findResultRules(config, answers) {
  return [...config.rules]
    .filter((rule) => rule.active)
    .sort((left, right) => left.priority - right.priority)
    .filter((rule) =>
      Object.entries(rule.conditions || {}).every(
        ([questionId, value]) => answers[questionId] === value,
      ),
    );
}

function buildResultNode(config, answers) {
  const rules = findResultRules(config, answers);

  if (rules.length === 0) {
    return {
      type: "missing-result",
      id: "missing-result",
      text: "一致する判定ルールがありません。",
    };
  }

  const toCandidate = (rule) => ({
    // ruleId は内部id（検索マッチング等が参照するため据え置き）。
    // displayRuleId は画面表示専用で、Excel上のルールID(sourceRuleId)を使う。
    // 旧スキーマ等でsourceRuleIdが無い場合はidをそのまま表示する。
    ruleId: rule.id,
    displayRuleId: rule.sourceRuleId || rule.id,
    expenseTypeId: rule.resultExpenseTypeId,
    expenseTypeName: getExpenseTypeName(config, rule.resultExpenseTypeId),
  });

  if (rules.length === 1) {
    return {
      type: "result",
      id: rules[0].id,
      ...toCandidate(rules[0]),
    };
  }

  return {
    type: "result",
    id: rules.map((rule) => rule.id).join("-"),
    candidates: rules.map(toCandidate),
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
