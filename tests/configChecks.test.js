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
        "q-trip": "yes",
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

function ids(items) {
  return items.map((item) => item.id);
}

describe("checkConfig", () => {
  it("問題がない場合はInfoを返す", () => {
    const result = checkConfig(validConfig);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.info[0].id).toBe("config-ok");
  });

  it("存在しない nextQuestionId をErrorとして検出する", () => {
    const result = checkConfig({
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

    expect(result.errors[0].message).toContain("q-missing");
  });

  it("rules.conditions の存在しない questionId をErrorとして検出する", () => {
    const result = checkConfig({
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

    expect(result.errors[0].message).toContain("q-missing");
  });

  it("存在しない resultExpenseTypeId をErrorとして検出する", () => {
    const result = checkConfig({
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

    expect(result.errors[0].message).toContain("missing_expense_type");
  });

  it("質問フローの循環参照をErrorとして検出する", () => {
    const result = checkConfig({
      ...validConfig,
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
              nextQuestionId: "q-category",
            },
          ],
        },
      ],
    });

    expect(ids(result.errors)).toContain("question-flow-loop-1");
  });

  it("未使用の質問をWarningとして検出する", () => {
    const result = checkConfig({
      ...validConfig,
      questions: [
        ...validConfig.questions,
        {
          id: "q-unused",
          text: "使われない質問ですか？",
          options: [],
        },
      ],
    });

    expect(ids(result.warnings)).toContain("unused-question-q-unused");
  });

  it("未使用の経費タイプをWarningとして検出する", () => {
    const result = checkConfig({
      ...validConfig,
      expenseTypes: [
        ...validConfig.expenseTypes,
        {
          id: "unused_expense_type",
          name: "未使用経費タイプ",
        },
      ],
    });

    expect(ids(result.warnings)).toContain(
      "unused-expense-type-unused_expense_type",
    );
  });

  it("開始質問から到達できない質問をWarningとして検出する", () => {
    const result = checkConfig({
      ...validConfig,
      questions: [
        ...validConfig.questions,
        {
          id: "q-unreachable",
          text: "到達できない質問ですか？",
          options: [],
        },
      ],
      rules: [
        ...validConfig.rules,
        {
          id: "r002",
          conditions: {
            "q-unreachable": "yes",
          },
          resultExpenseTypeId: "train_local",
        },
      ],
    });

    expect(ids(result.warnings)).toContain(
      "unreachable-question-q-unreachable",
    );
  });

  it("questions と rules が空の場合にErrorとして検出する", () => {
    const result = checkConfig({
      ...validConfig,
      questions: [],
      rules: [],
    });

    expect(ids(result.errors)).toEqual(["questions-empty", "rules-empty"]);
  });
});
