// company_code（人が識別するための会社スラッグ）1件分の値検証だけを切り出した
// 純粋関数。Deno固有のAPIには一切依存しないため、Node/vitestから直接
// importしてテストできる（_shared/concur-identity/validateConcurIdentityLookupRequest.js
// のvalidateConcurUserNameValue()と同じ「値1件分の検証をexportして複数の
// Edge Functionから共有する」方針）。
//
// check-concur-oauth・lookup-concur-userの両方が、会社別Concur OAuth接続の
// 解決（resolve_concur_oauth_company_id RPCへ渡すp_company_code）の入力として
// 使う。create-concur-quick-expense/validateQuickExpenseRequest.jsのcompanyId
// フィールドと同じ考え方で、ここでは「文字列として送られてきているか」だけを
// 確認する（実在するか・auth.uid()が所属しているかは、サーバー側のRPCが
// 最終的に判定する。フォーマットの厳密な検証をフロント・Edge Function側に
// 複製しない）。
//
// @param {unknown} value
// @returns {{ ok: true, companyCode: string } | { ok: false }}
export function validateCompanyCodeValue(value) {
  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false };
  }

  return { ok: true, companyCode: trimmed };
}
