// 既存config.json（questions/rules）から、管理画面編集用の flow データ構造へ変換する。
//
// 現行の06_判定ルールは「(ルールID, 条件グループ)」でまとめた条件テーブルだが、
// 実データを検証した結果、質問フローは合流点が無い純粋な木構造であることが分かっている
// （各質問への流入は常に1つ）。そのため、ルート質問から選択肢を辿るだけで、
// 各リーフ（次の質問を持たない選択肢）に対応する判定ルールを一意に特定できる。
//
// QuestionEngine.getResult() と同じ「回答履歴に対する rule.conditions の完全一致」判定を
// ここでも使い、ルート→リーフの経路上で実際に得られる回答だけを使って一致するルールを探す。
function findMatchingRules(rules, answers) {
  return (rules || [])
    .filter((rule) => rule.active !== false)
    .filter((rule) =>
      Object.entries(rule.conditions || {}).every(
        ([questionId, value]) => answers[questionId] === value,
      ),
    )
    .slice()
    .sort((left, right) => left.priority - right.priority);
}

function buildOptionNext(option, question, rules, answersUpToQuestion, warnings) {
  if (option.nextQuestionId) {
    return { type: "question", questionId: option.nextQuestionId };
  }

  const leafAnswers = {
    ...answersUpToQuestion,
    [question.id]: option.value,
  };
  const matchedRules = findMatchingRules(rules, leafAnswers);

  if (matchedRules.length === 0) {
    warnings.push(
      `質問「${question.text}」の選択肢「${option.label}」に一致する判定ルールが見つからなかったため、未設定として取り込みました。`,
    );
    return { type: "unset" };
  }

  return {
    type: "result",
    candidates: matchedRules.map((rule) => ({
      expenseTypeId: rule.resultExpenseTypeId,
      message: rule.message || "",
      warningMessage: rule.warningMessage || "",
      // 元のルールIDは画面には出さないが、逆変換時にできるだけ同じIDを再利用するために保持する。
      sourceRuleId: rule.sourceRuleId || rule.id,
    })),
  };
}

function walkQuestion(question, questionsById, rules, answersUpToQuestion, flow, warnings, visiting) {
  if (visiting.has(question.id)) {
    warnings.push(
      `質問「${question.text}」で循環参照を検出したため、それ以上先は取り込みませんでした。`,
    );
    return;
  }

  visiting.add(question.id);

  flow.questions[question.id] = {
    text: question.text || "",
    type: question.type || "single_select",
    optionIds: question.options.map((option) => option.id),
  };

  question.options.forEach((option) => {
    flow.options[option.id] = {
      label: option.label || "",
      next: buildOptionNext(option, question, rules, answersUpToQuestion, warnings),
    };

    if (option.nextQuestionId) {
      const nextQuestion = questionsById.get(option.nextQuestionId);

      if (!nextQuestion) {
        warnings.push(
          `質問「${question.text}」の選択肢「${option.label}」が参照する次の質問が見つかりませんでした。`,
        );
        return;
      }

      walkQuestion(
        nextQuestion,
        questionsById,
        rules,
        { ...answersUpToQuestion, [question.id]: option.value },
        flow,
        warnings,
        visiting,
      );
    }
  });

  visiting.delete(question.id);
}

// 戻り値: { flow, warnings }
// warnings は「取り込みでは表現しきれなかった内容」を人間向けに報告するためのもの。
// sample-company の現状データでは warnings が空になることをテストで担保する。
export function buildFlowFromConfig(config) {
  const questions = config?.questions || [];
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const flow = { rootQuestionId: null, questions: {}, options: {} };
  const warnings = [];

  const rootQuestion = questions[0];

  if (!rootQuestion) {
    return { flow, warnings };
  }

  flow.rootQuestionId = rootQuestion.id;
  walkQuestion(rootQuestion, questionsById, config.rules, {}, flow, warnings, new Set());

  const reachableQuestionIds = new Set(Object.keys(flow.questions));
  questions.forEach((question) => {
    if (!reachableQuestionIds.has(question.id)) {
      warnings.push(
        `質問「${question.text}」はどの選択肢からも辿り着けないため、取り込みの対象外になりました。`,
      );
    }
  });

  return { flow, warnings };
}
