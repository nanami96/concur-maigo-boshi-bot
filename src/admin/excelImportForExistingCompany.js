// 既存会社の通常管理画面（ExcelImportSection.jsx）からExcelインポートを行う際の、
// DOM/Reactから独立した判定・変換ロジック。
//
// 新規会社の初期セットアップ（InitialSetupScreen.jsx）では、Excelに書かれた
// 会社ID・会社名がそのままその会社の識別子になる。一方、既に存在する会社へ
// インポートする場合は話が別で、会社ID（内部識別子。CompanySettings.jsx参照：
// 「作成後は変更できません」という既存仕様がある）は絶対に現在編集中の会社から
// 変えてはならない。会社名はCompanySettings.jsxで通常編集可能な項目のため、
// Excelの内容で更新してよい。

// Excelに書かれた会社IDが、現在編集中の会社と異なるかどうか。
// どちらかが空（未設定）の場合は「異なる」とは判定しない
// （parseInitialSetupExcel.jsは会社名から会社IDを自動生成することがあるため、
// 現在の会社にまだ会社IDが無いケース等を誤って警告扱いにしないため）。
export function detectCompanyIdMismatch({ parsedCompanyId, currentCompanyId }) {
  return Boolean(parsedCompanyId && currentCompanyId && parsedCompanyId !== currentCompanyId);
}

// Excelから読み取った内容（company/policies/expenseTypes/flow）を、
// 現在編集中の会社の下書き（useWorkspaceEditorのstate）としてそのまま
// 使える形に変換する。company_idだけは常に現在の会社のものへ強制し、
// Excel側の値では絶対に上書きしない。
//
// concurExpenseTypeMappings（07_Concurマッピング、任意シート）だけは、
// policies/expenseTypes/flowとは異なる扱いをする。01_基本設定〜05_選択肢は
// parseInitialSetupExcel.js側で必須シートとして扱われているため「シートが
// 無い」という状態はそもそも発生せず、常に全体を置き換えて問題ない。しかし
// 07_Concurマッピングは任意シートのため、「このシートを含めずに再インポート
// した」場合にまで既存の下書きに保存済みのmappingを空へ消してしまうと、
// Concur連携設定だけを触るつもりの無い通常のExcel再インポート（質問フローの
// 修正等）のたびに、無関係なConcurマッピングが失われる事故になりかねない。
// そのため、
//   ・シートが無い（hasConcurMappingSheet=false） … 現在の下書きの値を維持する
//   ・シートがある（空でも） … Excelの内容（空なら空配列）へ置き換える
// という、「シートの有無＝そのシートを編集する意思の有無」という考え方で扱う。
export function buildWorkspaceStateFromImport({
  bundle,
  currentCompanyId,
  currentConcurExpenseTypeMappings = [],
}) {
  return {
    company: { ...bundle.company, company_id: currentCompanyId },
    policies: bundle.policies || [],
    expenseTypes: bundle.expenseTypes || [],
    flow: bundle.flow,
    concurExpenseTypeMappings: bundle.hasConcurMappingSheet
      ? bundle.concurExpenseTypeMappings || []
      : currentConcurExpenseTypeMappings || [],
  };
}
