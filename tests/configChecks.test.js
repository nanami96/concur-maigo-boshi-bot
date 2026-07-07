import { describe, expect, it } from "vitest";
import { checkConfig } from "../src/configChecks";

const validConfig = {
  questions: [
    {
      id: "q-category",
      text: "今日は何を申請しますか？",
      options: [
        {
          label: "電車",
          value: "train",
          nextQuestionId: "q-trip",
        },
      ],
    },
    {
      id: "q-trip",
      text: "出張ですか？",
      options: [
        {
          label: "はい",
          value: "yes",
        },
      ],
    },
  ],
  rules: [
    {
      id: "r001",
      conditions: {
        "q-category": "train",
      },
      resultExpenseTypeId: "train_local",
    },
  ],
  expenseTypes: [
    {
      id: "train_local",
      name: "電車・近隣交通費",
    },
  ],
};

describe("checkConfig", () => {
  it("参照に問題がない場合はエラーを返さない", () => {
    expect(checkConfig(validConfig)).toEqual([]);
  });

  it("存在しない nextQuestionId を検出する", () => {
    const issues = checkConfig({
      ...validConfig,
      questions: [
        {
          id: "q-category",
          text: "今日は何を申請しますか？",
          options: [
            {
              label: "電車",
              value: "train",
              nextQuestionId: "q-missing",
            },
          ],
        },
      ],
    });

    expect(issues[0].message).toContain("q-missing");
  });

  it("rules.conditions の存在しない questionId を検出する", () => {
    const issues = checkConfig({
      ...validConfig,
      rules: [
        {
          id: "r001",
          conditions: {
            "q-missing": "train",
          },
          resultExpenseTypeId: "train_local",
        },
      ],
    });

    expect(issues[0].message).toContain("q-missing");
  });

  it("存在しない resultExpenseTypeId を検出する", () => {
    const issues = checkConfig({
      ...validConfig,
      rules: [
        {
          id: "r001",
          conditions: {
            "q-category": "train",
          },
          resultExpenseTypeId: "missing_expense_type",
        },
      ],
    });

    expect(issues[0].message).toContain("missing_expense_type");
  });

  it("questions と rules が空の場合に検出する", () => {
    const issues = checkConfig({
      ...validConfig,
      questions: [],
      rules: [],
    });

    expect(issues.map((issue) => issue.id)).toEqual([
      "questions-empty",
      "rules-empty",
    ]);
  });
});
