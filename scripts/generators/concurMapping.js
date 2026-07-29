// 「07_Concurマッピング」（任意シート）を読み取り、config.concur.expenseTypeMappings
// を組み立てる。新スキーマ（04_質問/05_選択肢/06_判定ルール）・旧スキーマ
// （99_company_settings等）のどちらの会社設定からも共通で呼び出せるよう、
// 生のシート行ではなく、どちらのスキーマでも生成処理の最後には同じ形になる
// 正規化済みの値（company.company_id・policies[].policy_id・expenseTypes[].id）
// だけを受け取る、スキーマに依存しない設計にしている。
//
// companyId列を持たない理由（重要）：
// 01_基本設定の会社IDと必ず一致させる必要があるため、Excel側に同じ値を
// 二重入力させると転記ミスの元になる。そのため会社IDの列は設けず、常に
// company.company_id（01_基本設定/99_company_settings由来）から補完する。
// これは、管理画面向けの「初期設定Excel」の07_Concurマッピング
// （src/flow/parseInitialSetupExcel.js、会社IDを列として持ち、
// 01_基本設定と一致するか検証する別スキーマ）とは別物であり、
// あちらの列構成に合わせる必要はない（用途が異なる別のExcelパイプライン）。
//
// mappingMatchesKey相当の3キー（companyId・policyId・botExpenseTypeId）の
// 重複判定を、src/lib/concurExpenseTypeMapping.jsから直接importせず
// ここで複製している理由：scripts/配下はCommonJS（require）、src/lib/は
// ESM（export）であり、実行環境の境界をまたいだ直接importができないため
// （supabase/functions/create-concur-quick-expense/verifyConcurExpenseTypeMapping.js
// が同じ理由でsrc/lib/concurExpenseTypeMapping.jsのmappingMatchesKey()を
// 複製しているのと同じ判断）。
const { readSheet } = require("./sheetReader");

const SHEET_NAME = "07_Concurマッピング";

function toText(value) {
  return String(value ?? "").trim();
}

function mappingMatchesKey(entry, key) {
  return (
    entry.companyId === key.companyId &&
    entry.policyId === key.policyId &&
    entry.botExpenseTypeId === key.botExpenseTypeId
  );
}

// エラーメッセージ中でどの行を指しているか分かるようにするための表示用ラベル。
// readSheet()は全列が空白の行を除外して返す（sheetReader.jsのtoObjects参照）
// ため、除外後の配列に対するindexとExcel上の実際の行番号は一致しない。
// 行番号を出すと誤った行を指し示しかねないため、new-schema系の検証
// （scripts/generators/relationalSchema.jsのvalidateNewSchema）と同じく、
// 行番号ではなく入力値そのもので行を特定する。
function describeRow(row) {
  const policyId = toText(row["ポリシーID"]) || "(空欄)";
  const botExpenseTypeId = toText(row["経費タイプID"]) || "(空欄)";
  const concurExpenseTypeId = toText(row["Concur Expense Type Code"]) || "(空欄)";
  return `ポリシーID「${policyId}」・経費タイプID「${botExpenseTypeId}」・Concur Expense Type Code「${concurExpenseTypeId}」の行`;
}

/**
 * @param {object} input
 * @param {object} input.workbook xlsxのWorkbook（07_Concurマッピングシートを含みうる）。
 * @param {{ company_id?: string }} input.company 01_基本設定/99_company_settings由来の会社情報。
 * @param {Array<{ policy_id: string }>} input.policies 02_ポリシー/99_policies由来のポリシー一覧。
 * @param {Array<{ id: string }>} input.expenseTypes 03_経費タイプ/99_expense_types由来の経費タイプ一覧。
 * @returns {{
 *   concurExpenseTypeMappings: Array<{ companyId: string, policyId: string, botExpenseTypeId: string, concurExpenseTypeId: string }>,
 *   errors: string[],
 * }}
 */
function createConcurExpenseTypeMappings({ workbook, company, policies, expenseTypes }) {
  // シートが存在しない会社（Concur連携を使わない、またはまだ未対応の会社）では
  // readSheet()が空配列を返すだけで、既存の生成結果には一切影響しない。
  const rows = readSheet(workbook, SHEET_NAME);

  if (rows.length === 0) {
    return { concurExpenseTypeMappings: [], errors: [] };
  }

  const companyId = toText(company?.company_id);
  const policyIds = new Set((policies || []).map((policy) => toText(policy.policy_id)));
  const expenseTypeIds = new Set((expenseTypes || []).map((expenseType) => toText(expenseType.id)));

  const errors = [];
  const mappings = [];

  rows.forEach((row) => {
    const policyId = toText(row["ポリシーID"]);
    const botExpenseTypeId = toText(row["経費タイプID"]);
    const concurExpenseTypeId = toText(row["Concur Expense Type Code"]);

    const missingColumns = [];
    if (!policyId) missingColumns.push("ポリシーID");
    if (!botExpenseTypeId) missingColumns.push("経費タイプID");
    if (!concurExpenseTypeId) missingColumns.push("Concur Expense Type Code");

    if (missingColumns.length > 0) {
      errors.push(
        `【${SHEET_NAME}】${describeRow(row)}: ${missingColumns.join("・")}が入力されていません。`,
      );
      return;
    }

    if (!policyIds.has(policyId)) {
      errors.push(
        `【${SHEET_NAME}】${describeRow(row)}: ポリシーID「${policyId}」が02_ポリシーに存在しません。`,
      );
      return;
    }

    if (!expenseTypeIds.has(botExpenseTypeId)) {
      errors.push(
        `【${SHEET_NAME}】${describeRow(row)}: 経費タイプID「${botExpenseTypeId}」が03_経費タイプに存在しません。`,
      );
      return;
    }

    const candidate = { companyId, policyId, botExpenseTypeId, concurExpenseTypeId };

    if (mappings.some((existing) => mappingMatchesKey(existing, candidate))) {
      errors.push(
        `【${SHEET_NAME}】ポリシーID「${policyId}」・経費タイプID「${botExpenseTypeId}」の組み合わせが複数の行に存在します（重複）。`,
      );
      return;
    }

    mappings.push(candidate);
  });

  return { concurExpenseTypeMappings: mappings, errors };
}

module.exports = {
  createConcurExpenseTypeMappings,
};
