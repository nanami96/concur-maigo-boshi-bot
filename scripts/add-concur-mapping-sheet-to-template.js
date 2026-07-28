// excel/templates/initial-setup-template.xlsx に「07_Concurマッピング」シートを
// 追加するための、再実行可能なメンテナンススクリプト（scripts/update-excel-template.jsと
// 同様、テンプレート自体の生成・更新ロジックをコードとして残しておく方針）。
//
// exceljsで既存ファイルを読み込み・部分的に書き換えて保存するだけで、01_基本設定〜
// 05_選択肢・99_記入ガイドの既存シート自体には一切触れない（内容の変更は、
// 99_記入ガイドへの説明文追記のみ）。既にシートが存在する状態で再実行しても、
// 一旦削除してから作り直すため、意図した最終状態に収束する（冪等）。
//
// 実行方法: node scripts/add-concur-mapping-sheet-to-template.js
const path = require("path");
const ExcelJS = require("exceljs");

const TEMPLATE_PATH = path.join("excel", "templates", "initial-setup-template.xlsx");
const SHEET_NAME = "07_Concurマッピング";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDFC" } };
const HEADER_FONT = { bold: true };
const HEADER_ALIGNMENT = { vertical: "middle" };

const COLUMNS = [
  { header: "会社ID", width: 18 },
  { header: "ポリシーID", width: 20 },
  { header: "経費タイプID", width: 20 },
  { header: "Concur Expense Type Code", width: 28 },
];

// 99_記入ガイドの「■ シート構成」箇条書きへ、07_Concurマッピングの行を
// 99_記入ガイド自身の行（＝一覧の最後）の直前に挿入する。
const SHEET_LIST_ANCHOR = "99_記入ガイド … このシート";
const SHEET_LIST_NEW_LINE =
  "07_Concurマッピング … Concur Expense Type mapping一覧（任意。Concur連携を使わない場合はシートごと省略できます）";

// 「■ 使用有無=N の経費タイプ・ポリシーについて」の直前に、07_Concurマッピングの
// 説明セクションを挿入する（05_選択肢の説明セクションの直後になる）。
const NEW_SECTION_ANCHOR = "■ 使用有無=N の経費タイプ・ポリシーについて";
// 挿入先の直前には、既に元のガイドの空行（次見出しの前の区切り）が存在するため、
// ここでは先頭に空行を入れない。末尾には次見出し（■ 使用有無=N…）との区切りとして
// 空行を1行入れる（他のセクションと同じ「空行→見出し→本文」という並びに揃える）。
const NEW_SECTION_LINES = [
  "■ 07_Concurマッピング（任意シート。Concur連携を使わない場合はシートごと省略できます）",
  "会社ID：シートを使う場合は必須。01_基本設定の会社IDと同じ値を入力してください。",
  "ポリシーID：シートを使う場合は必須。02_ポリシーに存在するIDを入力してください。",
  "経費タイプID：シートを使う場合は必須。03_経費タイプに存在するIDを入力してください。",
  "Concur Expense Type Code：シートを使う場合は必須。Concur側で確認できた値をそのまま入力してください",
  "　（このガイドに記載の値はあくまで説明用の例であり、実在するConcurのコードではありません）。",
  "　同じ会社ID・ポリシーID・経費タイプIDの組み合わせを複数の行に記入することはできません。",
  "",
];

// 「AI向け」の推測禁止リストへ、07_Concurマッピングについての注意を追記する。
const AI_CAUTION_ANCHOR = "　・05_選択肢の質問フロー・分岐の設計そのもの（会社の実務プロセスに依存するため）";
const AI_CAUTION_NEW_LINE =
  "　・07_Concurマッピングの内容全体（Concur側から正式に確認できた値のみを使用し、推測で埋めない）";

function findRowNumberByFirstCellValue(sheet, targetValue) {
  const values = sheet.getSheetValues();
  const rowNumber = values.findIndex((row) => row && row[1] === targetValue);
  if (rowNumber === -1) {
    throw new Error(`ガイドシート内に想定した行が見つかりません: "${targetValue}"`);
  }
  return rowNumber;
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);

  const existing = workbook.getWorksheet(SHEET_NAME);
  if (existing) {
    workbook.removeWorksheet(existing.id);
  }

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = COLUMNS;

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = HEADER_ALIGNMENT;
  });

  const guide = workbook.getWorksheet("99_記入ガイド");
  if (!guide) {
    throw new Error("99_記入ガイドシートが見つかりません。");
  }

  // findRowNumberByFirstCellValueはspliceRowsのたびに現在のシート内容を
  // 再走査するため、以下3回の挿入はどの順番で行っても行番号のズレの影響を受けない。
  const sectionAnchorRow = findRowNumberByFirstCellValue(guide, NEW_SECTION_ANCHOR);
  guide.spliceRows(sectionAnchorRow, 0, ...NEW_SECTION_LINES.map((line) => [line]));

  const aiCautionAnchorRow = findRowNumberByFirstCellValue(guide, AI_CAUTION_ANCHOR);
  guide.spliceRows(aiCautionAnchorRow + 1, 0, [AI_CAUTION_NEW_LINE]);

  const sheetListAnchorRow = findRowNumberByFirstCellValue(guide, SHEET_LIST_ANCHOR);
  guide.spliceRows(sheetListAnchorRow, 0, [SHEET_LIST_NEW_LINE]);

  await workbook.xlsx.writeFile(TEMPLATE_PATH);

  console.log(`${TEMPLATE_PATH} に ${SHEET_NAME} シートを追加しました。`);
  console.log("99_記入ガイドへ説明を追記しました。");
}

main().catch((error) => {
  console.error("テンプレートの更新に失敗しました。");
  console.error(error.message);
  process.exit(1);
});
