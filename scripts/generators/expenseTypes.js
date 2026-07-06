function createExpenseTypes(expenseTypeSheet) {
  return expenseTypeSheet.map((item) => ({
    id: item.expense_type_id,
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