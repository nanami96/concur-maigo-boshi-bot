import { describe, it, expect } from "vitest";
import { computeAnswersToReachQuestion } from "../src/flow/computeAnswersToReachQuestion";
import { buildFlowFromConfig } from "../src/flow/buildFlowFromConfig";
import sampleCompanyConfig from "../rules/sample-company/config.json";

describe("computeAnswersToReachQuestion", () => {
  it("ルート質問自身は空配列", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    expect(computeAnswersToReachQuestion(flow, flow.rootQuestionId)).toEqual([]);
  });

  it("深い質問への経路を1本、実際に辿れる形で返す", () => {
    const { flow } = buildFlowFromConfig(sampleCompanyConfig);
    const deepQuestionId = Object.keys(flow.questions).find(
      (id) => id !== flow.rootQuestionId,
    );

    const path = computeAnswersToReachQuestion(flow, deepQuestionId);
    expect(path.length).toBeGreaterThan(0);

    // 経路を実際にシミュレートすると、対象質問へ到達できることを確認する。
    let cursor = flow.rootQuestionId;
    path.forEach(({ questionId, answer }) => {
      expect(questionId).toBe(cursor);
      const option = flow.options[answer];
      expect(option.next.type).toBe("question");
      cursor = option.next.questionId;
    });
    expect(cursor).toBe(deepQuestionId);
  });
});
