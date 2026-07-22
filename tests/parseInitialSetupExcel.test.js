import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import path from "node:path";
import { parseInitialSetupExcel, detectSchemaVersion } from "../src/flow/parseInitialSetupExcel";
import QuestionEngine from "../src/engine/QuestionEngine";
import sampleCompanyConfig from "../rules/sample-company/config.json";

function buildWorkbook(sheetsData) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheetsData).forEach(([name, rows]) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  });
  return workbook;
}

const BASIC_SHEET = [
  ["会社ID", "会社名", "schema_version"],
  ["test-co", "テスト会社", 1],
];

const POLICY_SHEET = [
  ["ポリシーID", "ポリシー名", "使用有無"],
  ["normal_expense", "通常経費", "Y"],
  ["business_trip", "出張経費", "N"],
];

const EXPENSE_SHEET = [
  ["経費タイプID", "ポリシーID", "経費タイプ名", "領収書要否", "使用有無"],
  ["taxi", "normal_expense", "タクシー", "必要", "Y"],
  ["train_local", "normal_expense", "電車", "不要", "Y"],
  ["postage", "normal_expense", "郵送費", "", "Y"],
  ["shipping_fee", "normal_expense", "配送費", "必要", "Y"],
  ["old_type", "normal_expense", "廃止タイプ", "必要", "N"],
  ["trip_type", "business_trip", "出張費", "必要", "Y"],
  ["unused_type", "normal_expense", "未使用タイプ", "必要", "Y"],
];

const QUESTION_SHEET = [
  ["質問キー", "質問文", "質問形式", "質問の表示順"],
  ["q1", "何の経費ですか？", "single_select", 10],
  ["q2", "交通費の種類は？", "single_select", 20],
];

const OPTION_SHEET = [
  ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
  ["q1", "交通費", "次の質問", "q2", "", "", ""],
  ["q1", "郵送関連", "結果", "", "postage", "「郵送費」を選択してください。", ""],
  ["q1", "郵送関連", "結果", "", "shipping_fee", "「配送費」を選択してください。", ""],
  ["q2", "タクシー", "結果", "", "taxi", "「タクシー」を選択してください。", "理由をコメントに記載してください。"],
  ["q2", "電車", "結果", "", "train_local", "「電車」を選択してください。", ""],
  ["q2", "出張費用", "結果", "", "trip_type", "「出張費」を選択してください。", ""],
  ["q2", "廃止タイプ選択", "結果", "", "old_type", "「廃止」を選択してください。", ""],
];

function buildValidSheets(overrides = {}) {
  return {
    "01_基本設定": BASIC_SHEET,
    "02_ポリシー": POLICY_SHEET,
    "03_経費タイプ": EXPENSE_SHEET,
    "04_質問": QUESTION_SHEET,
    "05_選択肢": OPTION_SHEET,
    ...overrides,
  };
}

describe("detectSchemaVersion", () => {
  it("空欄はnullを返す（旧形式）", () => {
    const workbook = buildWorkbook({ "01_基本設定": [["会社ID", "会社名"], ["a", "A社"]] });
    expect(detectSchemaVersion(workbook)).toBeNull();
  });

  it("1が読み取れる", () => {
    const workbook = buildWorkbook(buildValidSheets());
    expect(detectSchemaVersion(workbook)).toBe(1);
  });
});

describe("parseInitialSetupExcel 正常系", () => {
  it("基本的な正常系Excelをエラー0件で取り込める", () => {
    const workbook = buildWorkbook(buildValidSheets());
    const result = parseInitialSetupExcel(workbook);

    expect(result.errors).toEqual([]);
    expect(result.company).toEqual({ company_id: "test-co", company_name: "テスト会社" });
    expect(result.policies).toHaveLength(2);
    expect(result.expenseTypes).toHaveLength(7);
    expect(Object.keys(result.flow.questions)).toHaveLength(2);
  });

  it("領収書要否 必要/不要/空欄 が true/false/null に変換される", () => {
    const workbook = buildWorkbook(buildValidSheets());
    const result = parseInitialSetupExcel(workbook);

    const byId = Object.fromEntries(result.expenseTypes.map((e) => [e.id, e]));
    expect(byId.taxi.receiptRequired).toBe(true);
    expect(byId.train_local.receiptRequired).toBe(false);
    expect(byId.postage.receiptRequired).toBeNull();
  });

  it("使用有無=Nの経費タイプはactive=falseになる", () => {
    const workbook = buildWorkbook(buildValidSheets());
    const result = parseInitialSetupExcel(workbook);
    const byId = Object.fromEntries(result.expenseTypes.map((e) => [e.id, e]));
    expect(byId.old_type.active).toBe(false);
  });

  it("複数候補（同じ質問キー・同じボタン文言）が1つの選択肢の複数candidatesになる", () => {
    const workbook = buildWorkbook(buildValidSheets());
    const result = parseInitialSetupExcel(workbook);

    const postageOption = Object.values(result.flow.options).find(
      (option) => option.label === "郵送関連",
    );
    expect(postageOption.next.type).toBe("result");
    expect(postageOption.next.candidates).toHaveLength(2);
    expect(postageOption.next.candidates.map((c) => c.expenseTypeId).sort()).toEqual([
      "postage",
      "shipping_fee",
    ]);
  });

  it("警告: 領収書要否未設定・未使用経費タイプ・使用有無Nのポリシーに属する使用中経費タイプ・結果で参照する使用有無N経費タイプ", () => {
    const workbook = buildWorkbook(buildValidSheets());
    const result = parseInitialSetupExcel(workbook);
    const messages = result.warnings.map((w) => w.message).join("\n");

    expect(messages).toContain("郵送費");
    expect(messages).toContain("未使用タイプ");
    expect(messages).toContain("出張費");
    expect(messages).toContain("廃止タイプ");
  });

  it("ルート質問はq1（どの選択肢からも次の質問として参照されていない質問）", () => {
    const workbook = buildWorkbook(buildValidSheets());
    const result = parseInitialSetupExcel(workbook);
    expect(result.flow.questions[result.flow.rootQuestionId].text).toBe("何の経費ですか？");
  });

  it("会社IDが空欄の場合は会社名から自動生成される", () => {
    const workbook = buildWorkbook(
      buildValidSheets({ "01_基本設定": [["会社ID", "会社名", "schema_version"], ["", "テスト会社2", 1]] }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.company.company_id).toBeTruthy();
    expect(result.warnings.some((w) => w.id === "company-id-generated")).toBe(true);
  });
});

describe("parseInitialSetupExcel schema_version分岐", () => {
  it("schema_versionが空欄なら旧形式Errorを返しflowはnull", () => {
    const workbook = buildWorkbook({ "01_基本設定": [["会社ID", "会社名"], ["a", "A社"]] });
    const result = parseInitialSetupExcel(workbook);
    expect(result.flow).toBeNull();
    expect(result.errors.some((e) => e.id === "schema-version-legacy")).toBe(true);
  });

  it("schema_versionが2など未対応値ならErrorを返す", () => {
    const workbook = buildWorkbook(
      buildValidSheets({ "01_基本設定": [["会社ID", "会社名", "schema_version"], ["test-co", "テスト会社", 2]] }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.flow).toBeNull();
    expect(result.errors.some((e) => e.id === "schema-version-unsupported")).toBe(true);
  });
});

describe("parseInitialSetupExcel 異常系", () => {
  it("必須シート欠落を検出する", () => {
    const sheets = buildValidSheets();
    delete sheets["03_経費タイプ"];
    const workbook = buildWorkbook(sheets);
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id === "missing-sheet-03_経費タイプ")).toBe(true);
  });

  it("必須列欠落を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "02_ポリシー": [["ポリシーID", "ポリシー名"], ["normal_expense", "通常経費"]],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id === "missing-column-02_ポリシー-使用有無")).toBe(true);
  });

  it("質問キーの重複を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "04_質問": [
          ["質問キー", "質問文", "質問形式", "質問の表示順"],
          ["q1", "質問A", "single_select", 10],
          ["q1", "質問B", "single_select", 20],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id === "question-key-dup-q1")).toBe(true);
  });

  it("経費タイプIDの重複を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "03_経費タイプ": [
          ["経費タイプID", "ポリシーID", "経費タイプ名", "領収書要否", "使用有無"],
          ["taxi", "normal_expense", "タクシー", "必要", "Y"],
          ["taxi", "normal_expense", "タクシー2", "必要", "Y"],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id === "expense-id-dup-taxi")).toBe(true);
  });

  it("存在しない質問参照を検出する（次に質問する質問キー）", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "交通費", "次の質問", "q999", "", "", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("option-next-missing"))).toBe(true);
  });

  it("存在しない経費タイプ参照を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "タクシー", "結果", "", "does_not_exist", "案内", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("option-expense-missing"))).toBe(true);
  });

  it("循環参照を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "04_質問": [
          ["質問キー", "質問文", "質問形式", "質問の表示順"],
          ["q1", "質問1", "single_select", 10],
          ["q2", "質問2", "single_select", 20],
        ],
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "進む", "次の質問", "q2", "", "", ""],
          ["q2", "戻る", "次の質問", "q1", "", "", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.flow).toBeNull();
    expect(result.errors.some((e) => e.id === "cycle-detected")).toBe(true);
  });

  it("複数ルート候補を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "04_質問": [
          ["質問キー", "質問文", "質問形式", "質問の表示順"],
          ["q1", "質問1", "single_select", 10],
          ["q2", "質問2", "single_select", 20],
        ],
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "タクシー", "結果", "", "taxi", "案内", ""],
          ["q2", "電車", "結果", "", "train_local", "案内", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.flow).toBeNull();
    expect(result.errors.some((e) => e.id === "root-ambiguous")).toBe(true);
  });

  it("次のアクション不正を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "タクシー", "次の質問へ進む", "q2", "", "", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("option-action-invalid"))).toBe(true);
  });

  it("排他制約違反（次の質問なのに経費タイプIDが入力されている）を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "交通費", "次の質問", "q2", "taxi", "", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("option-exclusive-question"))).toBe(true);
  });

  it("結果なのに案内メッセージが無い場合を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "タクシー", "結果", "", "taxi", "", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("option-message-required"))).toBe(true);
  });

  it("複数候補グループ内でアクションが混在している場合を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "郵送関連", "結果", "", "postage", "案内", ""],
          ["q1", "郵送関連", "次の質問", "q2", "", "", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("group-mixed-action"))).toBe(true);
  });

  it("複数候補グループ内で経費タイプIDが重複している場合を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "05_選択肢": [
          ["質問キー", "ボタンに表示する文字", "次のアクション", "次に質問する質問キー", "経費タイプID", "案内メッセージ", "注意事項"],
          ["q1", "郵送関連", "結果", "", "postage", "案内1", ""],
          ["q1", "郵送関連", "結果", "", "postage", "案内2", ""],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("group-duplicate-expense"))).toBe(true);
  });

  it("存在しないポリシー参照を検出する", () => {
    const workbook = buildWorkbook(
      buildValidSheets({
        "03_経費タイプ": [
          ["経費タイプID", "ポリシーID", "経費タイプ名", "領収書要否", "使用有無"],
          ["taxi", "does_not_exist", "タクシー", "必要", "Y"],
        ],
      }),
    );
    const result = parseInitialSetupExcel(workbook);
    expect(result.errors.some((e) => e.id.startsWith("expense-policy-missing"))).toBe(true);
  });
});

describe("parseInitialSetupExcel: sample-company実データテンプレートでの検証", () => {
  it("excel/templates/initial-setup-template-v1.xlsx を読み込むと件数・flowが完全一致する", () => {
    const templatePath = path.resolve(
      __dirname,
      "../excel/templates/initial-setup-template-v1.xlsx",
    );
    const workbook = XLSX.readFile(templatePath);
    const result = parseInitialSetupExcel(workbook);

    expect(result.errors).toEqual([]);
    expect(result.policies).toHaveLength(2);
    expect(result.expenseTypes).toHaveLength(79);
    expect(Object.keys(result.flow.questions)).toHaveLength(16);

    const optionCount = Object.keys(result.flow.options).length;
    expect(optionCount).toBe(94);

    const resultOptions = Object.values(result.flow.options).filter((o) => o.next.type === "result");
    const questionOptions = Object.values(result.flow.options).filter((o) => o.next.type === "question");
    expect(resultOptions).toHaveLength(79);
    expect(questionOptions).toHaveLength(15);

    // 孤立質問の警告が出ていないこと（全16質問が到達可能）
    expect(result.warnings.some((w) => w.id.startsWith("question-unreachable"))).toBe(false);
  });

  it("パース結果からQuestionEngineで辿った全79経路の判定結果が既存config.jsonと完全一致する", () => {
    const templatePath = path.resolve(
      __dirname,
      "../excel/templates/initial-setup-template-v1.xlsx",
    );
    const workbook = XLSX.readFile(templatePath);
    const result = parseInitialSetupExcel(workbook);

    // flow -> QuestionEngineが使えるconfig形状へ変換（既存buildConfigFromFlowと同じ変換）するため、
    // ここでは既存のbuildConfigFromFlowをそのまま利用する。
    return import("../src/flow/buildConfigFromFlow").then(({ buildConfigFromFlow }) => {
      const config = buildConfigFromFlow(result.flow, {
        company: result.company,
        policies: result.policies,
        expenseTypes: result.expenseTypes,
      });

      const questionsById = new Map(config.questions.map((q) => [q.id, q]));

      function collectOutcomes(question, answersSoFar) {
        const outcomes = [];
        question.options.forEach((option) => {
          const nextAnswers = [...answersSoFar, option.value];
          if (option.nextQuestionId) {
            outcomes.push(...collectOutcomes(questionsById.get(option.nextQuestionId), nextAnswers));
            return;
          }
          const engine = new QuestionEngine(config);
          engine.getFirstQuestion();
          nextAnswers.forEach((answer) => engine.submitAnswer(answer));
          outcomes.push(engine.getResult());
        });
        return outcomes;
      }

      const outcomes = collectOutcomes(config.questions[0], []);
      expect(outcomes).toHaveLength(79);

      const outcomeKeySet = new Set(
        outcomes.map(
          (o) => `${o.expenseType?.id}|${o.rule?.message}|${o.rule?.warningMessage || ""}`,
        ),
      );
      const originalKeySet = new Set(
        sampleCompanyConfig.rules.map(
          (r) => `${r.resultExpenseTypeId}|${r.message}|${r.warningMessage || ""}`,
        ),
      );

      expect(outcomeKeySet.size).toBe(79);
      expect([...outcomeKeySet].sort()).toEqual([...originalKeySet].sort());
    });
  });
});
