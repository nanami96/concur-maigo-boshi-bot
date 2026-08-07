// _shared/concur-quick-expense/createConcurQuickExpense.js（実際にConcur
// Quick Expense v4 APIへfetchする実装）を、このEdge Functionの
// createQuickExpense DI引数の契約（(validatedPayload, context) => Promise<
// { result, error }>）へ橋渡しするアダプタ。
//
// 【重要・現時点ではまだ本番のデフォルト実装ではない】
// handleQuickExpenseRequest.jsのcreateQuickExpense引数の既定値は、
// index.tsの配線を変更していないため引き続きcreateQuickExpenseStub.js
// のままである。この関数はどこからも自動的には呼ばれず、注入されない限り
// Concur Quick Expense APIへの実通信は一切発生しない（安全ゲート・
// 実通信防止の設計は最終報告参照）。テスト（fetchImplモック）・将来の
// 本番切り替え（index.tsでこの関数をcreateQuickExpenseとして注入する）の
// ために用意している。
//
// 【userID・Access Tokenの扱い】
// contextで受け取るuserId・accessToken・geolocationはこの関数のローカル
// 引数としてのみ使用し、戻り値（result/error）には一切含めない
// （_shared/concur-quick-expense/createConcurQuickExpense.js自身も同じ方針）。
import { createConcurQuickExpense } from "../_shared/concur-quick-expense/createConcurQuickExpense.js";

/**
 * @param {ReturnType<typeof import("./validateQuickExpenseRequest.js").validateQuickExpenseRequest>["result"]} validatedPayload
 * @param {object} context
 * @param {string} context.accessToken Identity検索と同じOAuthフローで取得済みのAccess Token。
 * @param {string} context.geolocation OAuth token応答のgeolocation値（Quick Expense APIのベースURL）。
 * @param {string} context.userId Identity APIで解決済みのConcur userID。
 * @param {typeof fetch} [context.fetchImpl] テスト用の差し替え。
 * @param {number} [context.timeoutMs]
 * @returns {Promise<{ result: { quickExpenseId: string, status: string } | null, error: { code: string, message: string, details?: [] } | null }>}
 */
export async function createQuickExpenseViaConcur(validatedPayload, { accessToken, geolocation, userId, fetchImpl, timeoutMs } = {}) {
  const outcome = await createConcurQuickExpense({
    accessToken,
    geolocation,
    userId,
    contextType: "TRAVELER",
    expenseTypeId: validatedPayload.expenseTypeId,
    transactionDate: validatedPayload.transactionDate,
    amount: validatedPayload.amount,
    currencyCode: validatedPayload.currencyCode,
    vendorName: validatedPayload.vendorName,
    memo: validatedPayload.memo,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });

  if (!outcome.ok) {
    return { result: null, error: { ...outcome.error, details: [] } };
  }

  return { result: { quickExpenseId: outcome.quickExpenseIdUri, status: "created" }, error: null };
}
