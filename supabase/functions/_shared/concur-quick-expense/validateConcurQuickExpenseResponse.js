// Quick Expense API（POST .../quickexpenses）が201で返したJSON本文
// （パース済み）を検証する純粋関数。
//
// 【根拠（公式ドキュメントのみ、v4.quick-expense.md）】
// 成功応答の形（引用・実例）：
//   201 Created
//   {
//       "quickExpenseIdUri": "https://.../quickexpense/v4/users/{userID}/context/TRAVELER/quickexpenses/{id}"
//   }
// "Quick Expense Response"スキーマ：
//   quickExpenseIdUri | string | - | The quick expense created resource url.
//
// Locationヘッダーでの通知は公式ドキュメントに記載が無いため、この実装は
// JSON本文のquickExpenseIdUriだけを見る。
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {unknown} body Quick Expense APIレスポンスをJSON.parseした値。
 * @returns {
 *   | { ok: true, quickExpenseIdUri: string }
 *   | { ok: false, code: "concur_quick_expense_invalid_response" }
 * }
 */
export function validateConcurQuickExpenseResponse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "concur_quick_expense_invalid_response" };
  }

  if (!isNonEmptyString(body.quickExpenseIdUri)) {
    return { ok: false, code: "concur_quick_expense_invalid_response" };
  }

  return { ok: true, quickExpenseIdUri: body.quickExpenseIdUri };
}
