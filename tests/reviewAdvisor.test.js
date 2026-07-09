import { describe, expect, it } from "vitest";
import { generateReviewComments } from "../src/reviewAdvisor";

const baseConfig = {
  questions: [
    {
      id: "q-category",
      text: "What are you claiming?",
      options: [
        {
          label: "Train",
          value: "train",
          nextQuestionId: "q-trip",
        },
      ],
    },
    {
      id: "q-trip",
      text: "Is this a business trip?",
      options: [
        {
          label: "Yes",
          value: "yes",
        },
      ],
    },
  ],
  rules: [
    {
      id: "r-train",
      conditions: {
        "q-category": "train",
        "q-trip": "yes",
      },
      resultExpenseTypeId: "train",
    },
  ],
  expenseTypes: [
    {
      id: "train",
      name: "Train",
    },
  ],
};

function findCandidate(result, text) {
  return result.improvementCandidates.find((candidate) =>
    candidate.message.includes(text),
  );
}

describe("generateReviewComments", () => {
  it("returns good points when the config is clean", () => {
    const result = generateReviewComments(baseConfig);

    expect(result.goodPoints).toContain("未使用質問はありません。");
    expect(result.goodPoints).toContain(
      "開始質問から到達できない質問はありません。",
    );
    expect(result.improvementCandidates).toEqual([]);
  });

  it("adds medium severity to unused and unreachable review comments", () => {
    const result = generateReviewComments({
      ...baseConfig,
      questions: [
        ...baseConfig.questions,
        {
          id: "q-unused",
          text: "Unused question",
          options: [],
        },
      ],
      expenseTypes: [
        ...baseConfig.expenseTypes,
        {
          id: "taxi",
          name: "Taxi",
        },
      ],
    });

    expect(findCandidate(result, "未使用経費タイプがあります")).toMatchObject({
      severity: "medium",
      message: "未使用経費タイプがあります: taxi",
    });
    expect(findCandidate(result, "到達不能質問があります")).toMatchObject({
      severity: "medium",
      message: "到達不能質問があります: q-unused",
    });
  });

  it("adds low severity to rule consolidation suggestions", () => {
    const manyRules = Array.from({ length: 10 }, (_, index) => ({
      id: `r-${index}`,
      conditions: {
        "q-category": "train",
      },
      resultExpenseTypeId: "train",
    }));

    const result = generateReviewComments({
      ...baseConfig,
      rules: manyRules,
    });

    expect(findCandidate(result, "Rule数が多い")).toMatchObject({
      severity: "low",
      message:
        "Rule数が多いため、条件の統合や分割方針の見直しを検討してください。",
    });
  });

  it("adds high severity to invalid references and loops", () => {
    const result = generateReviewComments({
      questions: [
        {
          id: "q-start",
          text: "Start",
          options: [
            {
              label: "Loop",
              value: "loop",
              nextQuestionId: "q-loop",
            },
            {
              label: "Missing",
              value: "missing",
              nextQuestionId: "q-missing",
            },
          ],
        },
        {
          id: "q-loop",
          text: "Loop",
          options: [
            {
              label: "Back",
              value: "back",
              nextQuestionId: "q-start",
            },
          ],
        },
      ],
      rules: [
        {
          id: "r-invalid",
          conditions: {
            "q-unknown": "yes",
          },
          resultExpenseTypeId: "expense-unknown",
        },
      ],
      expenseTypes: [],
    });

    expect(findCandidate(result, "存在しない nextQuestionId")).toMatchObject({
      severity: "high",
    });
    expect(findCandidate(result, "存在しない質問ID")).toMatchObject({
      severity: "high",
    });
    expect(findCandidate(result, "存在しない経費タイプID")).toMatchObject({
      severity: "high",
    });
    expect(findCandidate(result, "循環参照")).toMatchObject({
      severity: "high",
    });
  });
});
