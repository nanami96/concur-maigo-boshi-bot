// 「ここから試す」プレビュー用：ルート質問から対象の質問に至るまでの回答を1つ求める。
// 木構造なので、対象質問へ至る経路が存在すれば一意に定まる。
export function computeAnswersToReachQuestion(flow, targetQuestionId) {
  function search(questionId, path) {
    if (questionId === targetQuestionId) {
      return path;
    }

    const question = flow.questions[questionId];

    if (!question) {
      return null;
    }

    for (const optionId of question.optionIds) {
      const option = flow.options[optionId];

      if (option?.next?.type === "question") {
        const result = search(option.next.questionId, [
          ...path,
          { questionId, answer: optionId },
        ]);

        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  if (!flow.rootQuestionId) {
    return [];
  }

  return search(flow.rootQuestionId, []) || [];
}
