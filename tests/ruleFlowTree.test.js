import { describe, expect, it } from "vitest";
import { buildRuleFlowTree } from "../src/ruleFlowBuilder";

const config = {
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
        {
          label: "タクシー",
          value: "taxi",
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
      id: "r-train",
      priority: 1,
      active: true,
      conditions: {
        "q-category": "train",
        "q-trip": "yes",
      },
      resultExpenseTypeId: "train_local",
    },
    {
      id: "r-taxi",
      priority: 2,
      active: true,
      conditions: {
        "q-category": "taxi",
      },
      resultExpenseTypeId: "taxi",
    },
  ],
  expenseTypes: [
    {
      id: "train_local",
      name: "電車・近隣交通費",
    },
    {
      id: "taxi",
      name: "タクシー",
    },
  ],
};

describe("buildRuleFlowTree", () => {
  it("開始質問から次の質問へ接続する", () => {
    const tree = buildRuleFlowTree(config);
    const trainOption = tree.child.children.find(
      (option) => option.value === "train",
    );

    expect(tree.type).toBe("start");
    expect(tree.child.id).toBe("q-category");
    expect(trainOption.child.type).toBe("question");
    expect(trainOption.child.id).toBe("q-trip");
  });

  it("nextQuestionId がない選択肢をルール結果へ接続する", () => {
    const tree = buildRuleFlowTree(config);
    const taxiOption = tree.child.children.find(
      (option) => option.value === "taxi",
    );

    expect(taxiOption.child.type).toBe("result");
    expect(taxiOption.child.ruleId).toBe("r-taxi");
    expect(taxiOption.child.expenseTypeName).toBe("タクシー");
  });

  it("次の質問の選択肢を回答パスに一致するルール結果へ接続する", () => {
    const tree = buildRuleFlowTree(config);
    const trainOption = tree.child.children.find(
      (option) => option.value === "train",
    );
    const yesOption = trainOption.child.children.find(
      (option) => option.value === "yes",
    );

    expect(yesOption.child.type).toBe("result");
    expect(yesOption.child.ruleId).toBe("r-train");
    expect(yesOption.child.expenseTypeName).toBe("電車・近隣交通費");
  });
});
