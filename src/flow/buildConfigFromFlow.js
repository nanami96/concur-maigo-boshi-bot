// 管理画面用の flow データ構造から、現行Botが利用する config.json と同じ形
// （questions[] / rules[]）を組み立てる。company / policies / expenseTypes は
// このコミットの対象外（Excel取り込み由来のデータをそのまま素通しする）。
//
// ポイント：管理者は「ルールID」や「AND条件」を一切設定しないが、
// ルート質問からリーフ（結果）までの経路上にある全ての (質問, 選択肢) の組を
// そのまま rule.conditions として復元することで、既存のQuestionEngineがそのまま使える
// 判定ルールを自動生成する。

function collectQuestionOrder(flow) {
  const order = [];
  const visited = new Set();

  function visit(questionId) {
    if (!questionId || visited.has(questionId) || !flow.questions[questionId]) {
      return;
    }

    visited.add(questionId);
    order.push(questionId);

    flow.questions[questionId].optionIds.forEach((optionId) => {
      const option = flow.options[optionId];

      if (option?.next?.type === "question") {
        visit(option.next.questionId);
      }
    });
  }

  visit(flow.rootQuestionId);

  return order;
}

// 質問ID → 「その質問に到達する直前の (親質問ID, 親選択肢ID)」のマップ。
// 木構造なので親は必ず高々1つ。ルート質問には親が存在しない。
function buildParentMap(flow, questionOrder) {
  const parentOf = {};

  questionOrder.forEach((questionId) => {
    flow.questions[questionId].optionIds.forEach((optionId) => {
      const option = flow.options[optionId];

      if (option?.next?.type === "question") {
        parentOf[option.next.questionId] = { questionId, optionId };
      }
    });
  });

  return parentOf;
}

function buildConditionsForLeaf(parentOf, questionId, optionId) {
  const conditions = { [questionId]: optionId };
  let cursor = questionId;

  while (parentOf[cursor]) {
    const { questionId: parentQuestionId, optionId: parentOptionId } = parentOf[cursor];
    conditions[parentQuestionId] = parentOptionId;
    cursor = parentQuestionId;
  }

  return conditions;
}

export function buildConfigFromFlow(flow, baseData = {}) {
  const { company, policies, expenseTypes } = baseData;
  const questionOrder = collectQuestionOrder(flow);
  const parentOf = buildParentMap(flow, questionOrder);

  const questions = questionOrder.map((questionId, index) => {
    const question = flow.questions[questionId];

    const options = question.optionIds.map((optionId) => {
      const option = flow.options[optionId];

      return {
        id: optionId,
        value: optionId,
        questionId,
        label: option.label,
        nextQuestionId:
          option.next?.type === "question" ? option.next.questionId : undefined,
      };
    });

    return {
      id: questionId,
      text: question.text,
      type: question.type || "single_select",
      displayOrder: (index + 1) * 10,
      options,
    };
  });

  const rules = [];
  let priority = 0;

  questionOrder.forEach((questionId) => {
    flow.questions[questionId].optionIds.forEach((optionId) => {
      const option = flow.options[optionId];

      if (option?.next?.type !== "result") {
        return;
      }

      const conditions = buildConditionsForLeaf(parentOf, questionId, optionId);

      (option.next.candidates || []).forEach((candidate, candidateIndex) => {
        priority += 1;

        rules.push({
          id: candidate.sourceRuleId || `${optionId}-r${candidateIndex + 1}`,
          sourceRuleId: candidate.sourceRuleId,
          priority,
          conditions,
          resultExpenseTypeId: candidate.expenseTypeId || "",
          message: candidate.message || "",
          warningMessage: candidate.warningMessage || "",
          active: true,
        });
      });
    });
  });

  return {
    company,
    policies,
    expenseTypes,
    questions,
    rules,
  };
}
