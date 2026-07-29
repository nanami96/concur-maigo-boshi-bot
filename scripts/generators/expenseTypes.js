// idはConcur側で自動採番される経費タイプコード（EXP_KEY）と同じ値として扱う。
// 先頭ゼロを含む数字列（例："01515"）もありうるため、Excelのセルがどんな型で
// 読み取られても必ず文字列へ揃える（数値化すると先頭ゼロが失われるため、
// Number()・parseInt()は使わない）。
function createExpenseTypes(expenseTypeSheet) {
  return expenseTypeSheet.map((item) => ({
    id: String(item.expense_type_id ?? "").trim(),
    policyId: item.policy_id,
    name: item.expense_type_name,
    receiptRequired: item.receipt_required === "Y",
    active: item.active === "Y",
    note: item.note || "",
  }));
}

module.exports = {
  createExpenseTypes,
};