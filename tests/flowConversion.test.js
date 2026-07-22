import { describe, it, expect } from "vitest";
import { buildFlowFromConfig } from "../src/flow/buildFlowFromConfig";
import { buildConfigFromFlow } from "../src/flow/buildConfigFromFlow";
import QuestionEngine from "../src/engine/QuestionEngine";
import sampleCompanyConfig from "../rules/sample-company/config.json";

// 木構造の全リーフ（次の質問を持たない選択肢）まで実際に回答を進め、
// 判定結果（経費タイプ・メッセージ・注意事項）を集める。
// QuestionEngineを実際に動かして確認することで、内部データ形式の一致ではなく
// 「動作として同等か」を検証する。
function collectLeafOutcomes(config) {
  const questionsById = new Map(config.questions.map((question) => [question.id, question]));
  const outcomes = [];

  function walk(question, answersSoFar) {
    question.options.forEach((option) => {
      const nextAnswers = [...answersSoFar, { questionId: question.id, answer: option.value }];

      if (option.nextQuestionId) {
        walk(questionsById.get(option.nextQuestionId), nextAnswers);
        return;
      }

      const engine = new QuestionEngine(config);
      engine.getFirstQuestion();
      nextAnswers.forEach(({ answer }) => engine.submitAnswer(answer));
      const result = engine.getResult();

      outcomes.push({
        path: nextAnswers.map((item) => item.answer).join(">"),
        result,
      });
    });
  }

  walk(config.questions[0], []);

  return outcomes;
}

describe("buildFlowFromConfig / buildConfigFromFlow の往復変換", () => {
  it("sample-companyの取り込みで警告が発生しない（現状データが純粋な木構造であることの裏付け）", () => {
    const { warnings } = buildFlowFromConfig(sampleCompanyConfig);
    expect(warnings).toEqual([]);
  });

  it("往復変換後も質問・選択肢の総数が変わらない", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    const rebuilt = buildConfigFromFlow(flow, {
      company: sampleCompanyConfig.company,
      policies: sampleCompanyConfig.policies,
      expenseTypes: sampleCompanyConfig.expenseTypes,
    });

    expect(rebuilt.questions.length).toBe(sampleCompanyConfig.questions.length);

    const originalOptionCount = sampleCompanyConfig.questions.reduce(
      (sum, question) => sum + question.options.length,
      0,
    );
    const rebuiltOptionCount = rebuilt.questions.reduce(
      (sum, question) => sum + question.options.length,
      0,
    );
    expect(rebuiltOptionCount).toBe(originalOptionCount);
  });

  it("全リーフ経路で、往復変換後も判定結果（経費タイプ・メッセージ・注意事項）が完全に一致する", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    const rebuilt = buildConfigFromFlow(flow, {
      company: sampleCompanyConfig.company,
      policies: sampleCompanyConfig.policies,
      expenseTypes: sampleCompanyConfig.expenseTypes,
    });

    const originalOutcomes = collectLeafOutcomes(sampleCompanyConfig);
    const rebuiltOutcomes = collectLeafOutcomes(rebuilt);

    expect(rebuiltOutcomes.length).toBe(originalOutcomes.length);

    originalOutcomes.forEach((original, index) => {
      const rebuiltOutcome = rebuiltOutcomes[index];
      expect(rebuiltOutcome.path).toBe(original.path);
      expect(rebuiltOutcome.result?.expenseType?.id).toBe(original.result?.expenseType?.id);
      expect(rebuiltOutcome.result?.rule?.message).toBe(original.result?.rule?.message);
      expect(rebuiltOutcome.result?.rule?.warningMessage).toBe(
        original.result?.rule?.warningMessage,
      );
    });

    // 現状データでは候補が複数になるリーフは存在しない（前回調査で確認済み）ことも合わせて担保する。
    originalOutcomes.forEach((original) => {
      expect(original.result?.candidates).toBeUndefined();
    });
  });

  it("質問と回答が空のフローは questions=[] / rules=[] になる", () => {
    const emptyFlow = { rootQuestionId: null, questions: {}, options: {} };
    const config = buildConfigFromFlow(emptyFlow, {});
    expect(config.questions).toEqual([]);
    expect(config.rules).toEqual([]);
  });
});
