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

describe("generateReviewComments", () => {
  it("returns good points when the config is clean", () => {
    const result = generateReviewComments(baseConfig);

    expect(result.goodPoints).toContain("未使用質問はありません。");
    expect(result.goodPoints).toContain(
      "開始質問から到達できない質問はありません。",
    );
    expect(result.improvementCandidates).toEqual([]);
  });

  it("detects unused expense types and unreachable questions", () => {
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

    expect(result.improvementCandidates).toContain(
      "未使用経費タイプがあります: taxi",
    );
    expect(result.improvementCandidates).toContain(
      "到達不能質問があります: q-unused",
    );
  });

  it("suggests rule consolidation when rule count is high", () => {
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

    expect(result.improvementCandidates).toContain(
      "Rule数が多いため、条件の統合や分割方針の見直しを検討してください。",
    );
  });
});
