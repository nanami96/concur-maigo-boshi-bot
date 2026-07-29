// 必要な部品を読み込む
// 共通処理
const { isFilled, toQuestionId } = require("./generators/utils");
// 経費タイプ生成
const { createExpenseTypes } = require("./generators/expenseTypes");
// 判定ルール生成
const { createRules } = require("./generators/rules");
// 質問生成
const { createQuestions } = require("./generators/questions");
const {
  getDataStartRowNumber,
  readSheet,
  readSheetMeta,
} = require("./generators/sheetReader");
// 新スキーマ（関係モデル: 04_質問/05_選択肢/06_判定ルール）専用の変換処理
const {
  createCompanyFromNewSchema,
  createPoliciesFromNewSchema,
  createExpenseTypesFromNewSchema,
  createQuestionsWithOptionsFromNewSchema,
  createRulesFromNewSchema,
  validateNewSchema,
} = require("./generators/relationalSchema");

// Excelとファイル操作用のライブラリを読み込む
// xlsx：Excelを読むため
// fs：config.jsonを書き出すため
const XLSX = require("xlsx");
const fs = require("fs");
const {
  validateExpenseTypes,
  validateRequiredFields,
  validateDuplicateExpenseTypeIds,
  validatePolicyReferences,
  validateCompanySettings,
  validateRequiredColumns,
} = require("./generators/validators");

// 複数企業対応
const companyId = process.argv[2] || "sample-company";

// 会社によって .xlsx（旧スキーマ）か .xlsm（マクロ有効・新スキーマ）かが異なるため両方試す
const xlsxPath = `excel/${companyId}.xlsx`;
const xlsmPath = `excel/${companyId}.xlsm`;
const excelPath = fs.existsSync(xlsxPath)
  ? xlsxPath
  : fs.existsSync(xlsmPath)
    ? xlsmPath
    : null;

if (!excelPath) {
  console.error(
    `config.json の生成に失敗しました。${xlsxPath} も ${xlsmPath} も見つかりません。`,
  );
  process.exit(1);
}

const workbook = XLSX.readFile(excelPath);

// 04_質問シートの有無で新スキーマ（関係モデル）かどうかを判定する
const isNewSchema = workbook.SheetNames.includes("04_質問");

let config;

if (isNewSchema) {
  // --- 新スキーマ（04_質問/05_選択肢/06_判定ルール）経路 ---
  const companySheet = readSheet(workbook, "01_基本設定");
  const policySheet = readSheet(workbook, "02_ポリシー");
  const expenseTypeSheet = readSheet(workbook, "03_経費タイプ");
  const questionSheet = readSheet(workbook, "04_質問");
  const optionSheet = readSheet(workbook, "05_選択肢");
  const ruleSheet = readSheet(workbook, "06_判定ルール");

  const { errors, warnings } = validateNewSchema({
    companySheet,
    policySheet,
    expenseTypeSheet,
    questionSheet,
    optionSheet,
    ruleSheet,
  });

  if (errors.length > 0) {
    console.error("config.json の生成に失敗しました。");
    console.error("");

    errors.forEach((error) => console.error(`❌ ${error}`));

    process.exit(1);
  }

  warnings.forEach((warning) => console.warn(`⚠️ ${warning}`));

  config = {
    company: createCompanyFromNewSchema(companySheet),
    policies: createPoliciesFromNewSchema(policySheet),
    expenseTypes: createExpenseTypesFromNewSchema(expenseTypeSheet),
    questions: createQuestionsWithOptionsFromNewSchema(
      questionSheet,
      optionSheet,
    ),
    rules: createRulesFromNewSchema(ruleSheet),
  };
} else {
  // --- 旧スキーマ（99_company_settings 等 + 横並び03_判定ルール）経路（既存のまま） ---
  const companySheet = readSheet(workbook, "99_company_settings");
  const policySheet = readSheet(workbook, "99_policies");
  const expenseTypeSheet = readSheet(workbook, "99_expense_types");
  const simpleRuleSheet = readSheet(workbook, "03_判定ルール");

  const companyMeta = readSheetMeta(workbook, "99_company_settings");
  const policyMeta = readSheetMeta(workbook, "99_policies");
  const expenseTypeMeta = readSheetMeta(workbook, "99_expense_types");
  const simpleRuleMeta = readSheetMeta(workbook, "03_判定ルール");

  // 申請内容がある行だけ使う
  const categoryRows = simpleRuleSheet.filter((row) => isFilled(row["申請内容"]));

  // 条件列を自動判定する
  const resultColumns = ["経費タイプ", "案内メッセージ", "注意事項"];

  const conditionColumns = Object.keys(categoryRows[0] || {}).filter(
    (columnName) => !resultColumns.includes(columnName),
  );

  // 質問を作る
  const questions = createQuestions(categoryRows, conditionColumns);

  // 経費タイプを作る
  const expenseTypes = createExpenseTypes(expenseTypeSheet);

  // Excelのエラーチェック
  const validationErrors = [
    ...validateRequiredColumns(
      companySheet,
      companyMeta,
      "99_company_settings",
      getDataStartRowNumber("99_company_settings"),
    ),
    ...validateRequiredColumns(
      categoryRows,
      simpleRuleMeta,
      "03_判定ルール",
      getDataStartRowNumber("03_判定ルール"),
    ),
    ...validateExpenseTypes(
      categoryRows,
      expenseTypes,
      getDataStartRowNumber("03_判定ルール"),
    ),
    ...validateDuplicateExpenseTypeIds(
      expenseTypeSheet,
      getDataStartRowNumber("99_expense_types"),
    ),
    ...validatePolicyReferences(
      expenseTypeSheet,
      policySheet,
      getDataStartRowNumber("99_expense_types"),
    ),
  ];

  if (validationErrors.length > 0) {
    console.error("config.json の生成に失敗しました。");
    console.error("");

    validationErrors.forEach((error) => console.error(`❌ ${error}`));

    process.exit(1);
  }

  // ルールを作る
  const rules = createRules(
    categoryRows,
    conditionColumns,
    expenseTypes,
    toQuestionId,
  );

  // config.json全体を組み立てる
  config = {
    company: companySheet[0],
    policies: policySheet,
    expenseTypes,
    questions,
    rules,
  };
}

// 出力フォルダを作る
const outputDir = `rules/${companyId}`;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// config.jsonを書き出す
fs.writeFileSync(
  `${outputDir}/config.json`,
  JSON.stringify(config, null, 2),
  "utf8",
);

console.log("config.json を生成しました！");
