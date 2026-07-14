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
        {
          label: "宿泊",
          value: "hotel",
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
    {
      id: "r-hotel-1",
      priority: 3,
      active: true,
      conditions: {
        "q-category": "hotel",
      },
      resultExpenseTypeId: "hotel_fee",
    },
    {
      id: "r-hotel-2",
      priority: 4,
      active: true,
      conditions: {
        "q-category": "hotel",
      },
      resultExpenseTypeId: "hotel_breakfast",
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
    {
      id: "hotel_fee",
      name: "宿泊費",
    },
    {
      id: "hotel_breakfast",
      name: "宿泊時朝食代",
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

  it("複数条件のルールは、全条件が揃うまでは結果ノードにならない", () => {
    const tree = buildRuleFlowTree(config);
    const trainOption = tree.child.children.find(
      (option) => option.value === "train",
    );

    // q-category=train だけでは r-train（q-category+q-trip の2条件）は確定せず、
    // 次の質問(q-trip)がそのまま表示される。
    expect(trainOption.child.type).toBe("question");
    expect(trainOption.child.id).toBe("q-trip");

    // q-trip=yes まで揃って初めて結果ノードになる。
    const yesOption = trainOption.child.children.find(
      (option) => option.value === "yes",
    );
    expect(yesOption.child.type).toBe("result");
    expect(yesOption.child.ruleId).toBe("r-train");
  });

  it("同一条件に複数のルールが一致する場合、先頭1件に絞らずcandidatesとして全件返す", () => {
    const tree = buildRuleFlowTree(config);
    const hotelOption = tree.child.children.find(
      (option) => option.value === "hotel",
    );

    expect(hotelOption.child.type).toBe("result");
    expect(hotelOption.child.candidates).toHaveLength(2);
    expect(
      hotelOption.child.candidates.map((candidate) => candidate.expenseTypeName),
    ).toEqual(["宿泊費", "宿泊時朝食代"]);
  });

  it("sourceRuleIdがある場合、画面表示用のdisplayRuleIdにはExcelのルールID（条件グループ抜き）を使う", () => {
    const configWithSourceRuleId = {
      questions: [
        {
          id: "q-category",
          text: "今日は何を申請しますか？",
          options: [{ label: "郵便", value: "postage" }],
        },
      ],
      rules: [
        {
          id: "r058-g1",
          sourceRuleId: "r058",
          priority: 1,
          active: true,
          conditions: { "q-category": "postage" },
          resultExpenseTypeId: "postage",
        },
      ],
      expenseTypes: [{ id: "postage", name: "郵便料金" }],
    };

    const tree = buildRuleFlowTree(configWithSourceRuleId);
    const postageOption = tree.child.children.find(
      (option) => option.value === "postage",
    );

    expect(postageOption.child.type).toBe("result");
    // 内部id（検索マッチング等が参照する）は据え置き
    expect(postageOption.child.ruleId).toBe("r058-g1");
    // 画面表示用はExcelのルールIDのみ（条件グループの"-g1"は含まない）
    expect(postageOption.child.displayRuleId).toBe("r058");
  });

  it("sourceRuleIdが無い場合（旧スキーマ等）はidをそのままdisplayRuleIdとして使う", () => {
    const tree = buildRuleFlowTree(config);
    const taxiOption = tree.child.children.find(
      (option) => option.value === "taxi",
    );

    expect(taxiOption.child.ruleId).toBe("r-taxi");
    expect(taxiOption.child.displayRuleId).toBe("r-taxi");
  });
});
