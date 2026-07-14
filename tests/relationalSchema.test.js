import { describe, expect, it } from "vitest";
import {
  createCompanyFromNewSchema,
  createPoliciesFromNewSchema,
  createExpenseTypesFromNewSchema,
  createQuestionsWithOptionsFromNewSchema,
  createRulesFromNewSchema,
  validateNewSchema,
} from "../scripts/generators/relationalSchema";

const companySheet = [{ 会社ID: "sample-company", 会社名: "サンプル会社" }];

const policySheet = [
  { ポリシーID: "normal_expense", ポリシー名: "通常経費", 使用有無: "Y" },
];

const expenseTypeSheet = [
  {
    経費タイプID: "train_local",
    ポリシーID: "normal_expense",
    経費タイプ名: "電車・近隣交通費",
    領収書有無: "N",
    使用有無: "Y",
  },
  {
    経費タイプID: "taxi",
    ポリシーID: "normal_expense",
    経費タイプ名: "タクシー",
    領収書有無: "Y",
    使用有無: "Y",
  },
];

const questionSheet = [
  { 質問ID: "Q002", 質問文: "出張ですか？", 質問形式: "single_select", 質問の表示順: 20 },
  { 質問ID: "Q001", 質問文: "移動手段は？", 質問形式: "single_select", 質問の表示順: 10 },
];

const optionSheet = [
  { 選択肢ID: "O001", 質問ID: "Q001", ボタンに表示する文字: "電車・地下鉄", 次に質問する質問ID: "Q002" },
  { 選択肢ID: "O002", 質問ID: "Q001", ボタンに表示する文字: "タクシー", 次に質問する質問ID: "" },
  { 選択肢ID: "O003", 質問ID: "Q002", ボタンに表示する文字: "はい", 次に質問する質問ID: "" },
];

const ruleSheet = [
  {
    ルールID: "r001",
    判定対象の質問ID: "Q001",
    選択肢ID: "O001",
    表示する経費タイプID: "train_local",
    ユーザーへ案内するメッセージ: "「電車」を選択してください。",
    注意事項: "",
  },
  {
    ルールID: "r002",
    判定対象の質問ID: "Q001",
    選択肢ID: "O002",
    表示する経費タイプID: "taxi",
    ユーザーへ案内するメッセージ: "「タクシー」を選択してください。",
    注意事項: "理由を記載してください。",
  },
];

describe("relationalSchema", () => {
  it("会社設定をExcelの値のまま変換する", () => {
    expect(createCompanyFromNewSchema(companySheet)).toEqual({
      company_id: "sample-company",
      company_name: "サンプル会社",
    });
  });

  it("ポリシーを変換する", () => {
    expect(createPoliciesFromNewSchema(policySheet)).toEqual([
      { policy_id: "normal_expense", policy_name: "通常経費", enabled: "Y" },
    ]);
  });

  it("経費タイプを変換し、Y/Nをbooleanへ変換する", () => {
    const result = createExpenseTypesFromNewSchema(expenseTypeSheet);

    expect(result[0]).toEqual({
      id: "train_local",
      policyId: "normal_expense",
      name: "電車・近隣交通費",
      receiptRequired: false,
      active: true,
      note: "",
    });
  });

  it("質問を表示順で並べ替え、選択肢IDの大文字小文字をそのまま保持する", () => {
    const questions = createQuestionsWithOptionsFromNewSchema(
      questionSheet,
      optionSheet,
    );

    expect(questions.map((q) => q.id)).toEqual(["Q001", "Q002"]);

    const q1 = questions.find((q) => q.id === "Q001");
    expect(q1.options.map((o) => o.id)).toEqual(["O001", "O002"]);
    expect(q1.options[0].value).toBe("O001");
    expect(q1.options[0].nextQuestionId).toBe("Q002");
    expect(q1.options[1].nextQuestionId).toBeUndefined();
  });

  it("条件グループ列が無い（単一行ルール）場合は従来どおり1行1ルールとして生成し、idにはg1が付与される", () => {
    const rules = createRulesFromNewSchema(ruleSheet);

    expect(rules[0]).toEqual({
      id: "r001-g1",
      sourceRuleId: "r001",
      priority: 1,
      conditions: { Q001: "O001" },
      resultExpenseTypeId: "train_local",
      message: "「電車」を選択してください。",
      warningMessage: "",
      active: true,
    });
  });

  it("参照が正しいデータではエラーが出ない", () => {
    const { errors } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet,
      ruleSheet,
    });

    expect(errors).toEqual([]);
  });

  it("存在しない質問IDを参照するとエラーになる", () => {
    const brokenOptionSheet = [
      { 選択肢ID: "O001", 質問ID: "Q999", ボタンに表示する文字: "不明", 次に質問する質問ID: "" },
    ];

    const { errors } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet: brokenOptionSheet,
      ruleSheet: [],
    });

    expect(errors.some((error) => error.includes("Q999"))).toBe(true);
  });

  it("終端選択肢に対応する判定ルールが無い場合はWarningになる", () => {
    const { warnings } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet,
      ruleSheet: [],
    });

    expect(warnings.some((warning) => warning.includes("O002"))).toBe(true);
  });
});

describe("条件グループによるルールのグループ化", () => {
  const multiConditionRuleSheet = [
    {
      ルールID: "r010",
      条件グループ: 1,
      判定対象の質問ID: "Q001",
      選択肢ID: "O001",
      表示する経費タイプID: "train_local",
      ユーザーへ案内するメッセージ: "電車出張として案内",
      注意事項: "出張規程を確認",
    },
    {
      ルールID: "r010",
      条件グループ: 1,
      判定対象の質問ID: "Q002",
      選択肢ID: "O003",
      表示する経費タイプID: "train_local",
      ユーザーへ案内するメッセージ: "電車出張として案内",
      注意事項: "出張規程を確認",
    },
    {
      ルールID: "r010",
      条件グループ: 2,
      判定対象の質問ID: "Q001",
      選択肢ID: "O002",
      表示する経費タイプID: "taxi",
      ユーザーへ案内するメッセージ: "タクシーとして案内",
      注意事項: "",
    },
  ];

  it("1. 同一ルールID・同一条件グループの複数行が1つのconditionsへ統合される", () => {
    const rules = createRulesFromNewSchema(multiConditionRuleSheet);
    const group1 = rules.find((rule) => rule.id === "r010-g1");

    expect(group1.conditions).toEqual({ Q001: "O001", Q002: "O003" });
    expect(group1.resultExpenseTypeId).toBe("train_local");
    expect(group1.message).toBe("電車出張として案内");
    expect(group1.warningMessage).toBe("出張規程を確認");
  });

  it("2. 条件グループが異なる場合は別ルールになる", () => {
    const rules = createRulesFromNewSchema(multiConditionRuleSheet);

    expect(rules).toHaveLength(2);
    const group2 = rules.find((rule) => rule.id === "r010-g2");
    expect(group2.conditions).toEqual({ Q001: "O002" });
    expect(group2.resultExpenseTypeId).toBe("taxi");
  });

  it("3. 生成後のIDがr001-g1、r001-g2のような形式になる", () => {
    const rules = createRulesFromNewSchema(multiConditionRuleSheet);

    expect(rules.map((rule) => rule.id)).toEqual(["r010-g1", "r010-g2"]);
  });

  it("4. 条件グループ空欄は1として扱う（列自体が無い場合・空文字・数値1も同一グループに統合）", () => {
    const rows = [
      {
        ルールID: "r020",
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
      {
        ルールID: "r020",
        条件グループ: "",
        判定対象の質問ID: "Q002",
        選択肢ID: "O003",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
      {
        ルールID: "r020",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
    ];

    const rules = createRulesFromNewSchema(rows);

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("r020-g1");
    expect(rules[0].conditions).toEqual({ Q001: "O001", Q002: "O003" });
  });

  it("5. 同一グループ内で経費タイプIDが一致しない場合はエラーになる", () => {
    const rows = [
      {
        ルールID: "r030",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
      {
        ルールID: "r030",
        条件グループ: 1,
        判定対象の質問ID: "Q002",
        選択肢ID: "O003",
        表示する経費タイプID: "taxi",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
    ];

    const { errors } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet,
      ruleSheet: rows,
    });

    expect(errors.some((error) => error.includes("経費タイプID"))).toBe(true);
  });

  it("6. 同一グループ内で案内メッセージが一致しない場合はエラーになる", () => {
    const rows = [
      {
        ルールID: "r031",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "メッセージA",
        注意事項: "",
      },
      {
        ルールID: "r031",
        条件グループ: 1,
        判定対象の質問ID: "Q002",
        選択肢ID: "O003",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "メッセージB",
        注意事項: "",
      },
    ];

    const { errors } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet,
      ruleSheet: rows,
    });

    expect(
      errors.some((error) => error.includes("案内するメッセージ")),
    ).toBe(true);
  });

  it("7. 同一グループ内で注意事項が一致しない場合はエラーになる", () => {
    const rows = [
      {
        ルールID: "r032",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "注意A",
      },
      {
        ルールID: "r032",
        条件グループ: 1,
        判定対象の質問ID: "Q002",
        選択肢ID: "O003",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "注意B",
      },
    ];

    const { errors } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet,
      ruleSheet: rows,
    });

    expect(errors.some((error) => error.includes("注意事項"))).toBe(true);
  });

  it("8. 同一グループ内で同一質問IDに異なる選択肢IDがある場合はエラーになる", () => {
    const rows = [
      {
        ルールID: "r033",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
      {
        ルールID: "r033",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O002",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
    ];

    const { errors } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet,
      ruleSheet: rows,
    });

    expect(
      errors.some((error) => error.includes("異なる選択肢ID")),
    ).toBe(true);
  });

  it("9. 完全重複行（同一質問ID・同一選択肢ID）はWarningとして報告され、生成は継続する", () => {
    const rows = [
      {
        ルールID: "r034",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
      {
        ルールID: "r034",
        条件グループ: 1,
        判定対象の質問ID: "Q001",
        選択肢ID: "O001",
        表示する経費タイプID: "train_local",
        ユーザーへ案内するメッセージ: "M",
        注意事項: "",
      },
    ];

    const { errors, warnings } = validateNewSchema({
      companySheet,
      policySheet,
      expenseTypeSheet,
      questionSheet,
      optionSheet,
      ruleSheet: rows,
    });

    expect(errors).toEqual([]);
    expect(warnings.some((warning) => warning.includes("重複"))).toBe(true);

    const rules = createRulesFromNewSchema(rows);
    expect(rules).toHaveLength(1);
    expect(rules[0].conditions).toEqual({ Q001: "O001" });
  });

  it("10. 単一行ルールも従来どおり生成できる（他のルールIDと混在してもグループが混ざらない）", () => {
    const rules = createRulesFromNewSchema(ruleSheet);

    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.id)).toEqual(["r001-g1", "r002-g1"]);
    expect(rules[1].conditions).toEqual({ Q001: "O002" });
  });
});
