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
export function buildWorkspaceStateFromImport({ bundle, currentCompanyId }) {
  return {
    company: { ...bundle.company, company_id: currentCompanyId },
    policies: bundle.policies || [],
    expenseTypes: bundle.expenseTypes || [],
    flow: bundle.flow,
  };
}
